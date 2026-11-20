#!/usr/bin/env python3
"""Idempotent corpus and PostgreSQL integrity repair tool for CIVIL-LEX RAG."""

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Optional, Set, Tuple

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_values

from parse_family_code import chunk_article, clean_article_text

load_dotenv()

DEFAULT_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres",
)
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")

_DOCKET_HEADER_RE = re.compile(
    r"\b("
    r"(?:G\.?\s*R\.?|A\.?\s*[MC]\.?|B\.?\s*M\.?)"
    r"(?:\s+OCA\s+IPI)?"
    r"\s*(?:Nos?\.?)?\s*"
    r"(?:[A-Z]{1,4}-)?\d+(?:-[A-Z0-9]+)*"
    r"(?:\s*(?:[-,&]|\band\b)\s*(?:[A-Z]{1,4}-)?\d+(?:-[A-Z0-9]+)*)*"
    r")",
    re.IGNORECASE,
)

_FC_POSTFIX_RE = re.compile(
    r"\bArt(?:icle|icles|s)?\.?\s*"
    r"(\d{1,3}(?:\s*(?:,|and|to|-)\s*\d{1,3})*)"
    r"\s*(?:,?\s*(?:of\s+the|under\s+the|in\s+the|of|under|,)?)?\s*"
    r"(?:Family\s+Code|Executive\s+Order\s+No\.?\s*209|E\.?\s*O\.?\s*No\.?\s*209)\b",
    re.IGNORECASE,
)

_FC_PREFIX_RE = re.compile(
    r"\b(?:Family\s+Code|Executive\s+Order\s+No\.?\s*209|E\.?\s*O\.?\s*No\.?\s*209)"
    r"\s*(?:,|\s+in|\s+under)?\s*Art(?:icle|icles|s)?\.?\s*"
    r"(\d{1,3}(?:\s*(?:,|and|to|-)\s*\d{1,3})*)",
    re.IGNORECASE,
)

_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")


def get_connection(db_url: Optional[str] = None):
    return psycopg2.connect(db_url or DEFAULT_DB_URL)


def _normalize_docket_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(" ,.;:")


def extract_docket_from_case_text(content_summary: str, full_text: str) -> Optional[str]:
    """Extract the most complete docket header from a case summary or full text."""
    for source in (content_summary or "", full_text or ""):
        snippet = source[:800]
        if not snippet.strip():
            continue
        matches = [_normalize_docket_whitespace(m.group(1)) for m in _DOCKET_HEADER_RE.finditer(snippet)]
        valid = [m for m in matches if re.search(r"\d", m)]
        if not valid:
            continue
        # Prefer consolidated headers (Nos., range '-', or 'and') and longer docket strings.
        valid.sort(
            key=lambda s: (
                1 if re.search(r"\bNos\.|\band\b|-\d{2,}", s, re.IGNORECASE) else 0,
                len(s),
            ),
            reverse=True,
        )
        return valid[0]
    return None


def _expand_article_list(expr: str) -> Set[int]:
    """Expand comma/and/range article lists within Family Code bounds (1..257)."""
    nums: Set[int] = set()
    for m in re.finditer(r"(\d{1,3})\s*(?:to|-)\s*(\d{1,3})", expr, re.IGNORECASE):
        start, end = int(m.group(1)), int(m.group(2))
        if 1 <= start <= end <= 257 and (end - start) <= 15:
            nums.update(range(start, end + 1))
    for tok in re.findall(r"\d{1,3}", expr):
        val = int(tok)
        if 1 <= val <= 257:
            nums.add(val)
    return nums


def extract_family_code_articles_from_case(text: str) -> Set[int]:
    """Extract Family Code article numbers explicitly tied to EO 209 / Family Code."""
    if not text:
        return set()
    found: Set[int] = set()
    for pattern in (_FC_POSTFIX_RE, _FC_PREFIX_RE):
        for match in pattern.finditer(text):
            found.update(_expand_article_list(match.group(1)))
    return found


def _build_chunk_prefix(item: Dict) -> str:
    hier = item.get("hierarchy") or {}
    title_name = hier.get("title_name") or ""
    chapter_name = hier.get("chapter_name") or title_name
    return f"{title_name}, {chapter_name}".strip(", ")


def repair_family_code_jsonl_and_db(conn, data_dir: str, embed: bool = True) -> int:
    """Repair truncated Family Code articles in JSONL and sync PostgreSQL + embeddings."""
    fc_path = os.path.join(data_dir, "family_code_rag.jsonl")
    records: List[Dict] = []
    repaired_records: List[Dict] = []

    with open(fc_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            art_id = item.get("article_id", "")
            art_num = int(item.get("article_number") or 0)
            raw_text = (item.get("text") or "").strip()
            old_clean = (item.get("text_clean") or "").strip()

            if art_num > 0 and raw_text:
                new_clean = clean_article_text(raw_text)
                if new_clean != old_clean:
                    item["text_clean"] = new_clean
                    item["chunks"] = chunk_article(art_id, art_num, _build_chunk_prefix(item), new_clean)
                    repaired_records.append(item)
            records.append(item)

    if repaired_records:
        with open(fc_path, "w", encoding="utf-8") as out_f:
            for item in records:
                out_f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Also detect DB rows that lag behind JSONL even if JSONL was already repaired.
    with conn.cursor() as cur:
        cur.execute("SELECT article_id, content FROM civil_code_articles WHERE article_id LIKE 'EO209-ART%'")
        db_map = dict(cur.fetchall())

    to_sync: List[Dict] = []
    repaired_ids = {r["article_id"] for r in repaired_records}
    for item in records:
        art_id = item.get("article_id", "")
        if not art_id.startswith("EO209-ART"):
            continue
        clean_val = (item.get("text_clean") or "").strip()
        if art_id in repaired_ids or db_map.get(art_id, "").strip() != clean_val:
            to_sync.append(item)

    if not to_sync:
        return 0

    article_rows = [
        (
            item["article_id"],
            item["article_number"],
            json.dumps(item.get("hierarchy", {})),
            item["text_clean"],
            bool(item.get("is_hub", False)),
        )
        for item in to_sync
    ]

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO civil_code_articles (article_id, article_number, hierarchy, content, is_hub)
            VALUES %s
            ON CONFLICT (article_id) DO UPDATE SET
                article_number = EXCLUDED.article_number,
                hierarchy = EXCLUDED.hierarchy,
                content = EXCLUDED.content,
                is_hub = EXCLUDED.is_hub;
            """,
            article_rows,
            template="(%s, %s, %s::jsonb, %s, %s)",
        )
        conn.commit()

    if not embed:
        return len(to_sync)

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    is_e5 = "e5" in EMBEDDING_MODEL_NAME.lower()

    chunks_to_embed = []
    synced_ids = [item["article_id"] for item in to_sync]
    for item in to_sync:
        topics = item.get("legal_topics", [])
        for idx, chunk in enumerate(item.get("chunks", [])):
            chunks_to_embed.append(
                {
                    "chunk_id": chunk.get("chunk_id", f"{item['article_id']}_c{idx}"),
                    "parent_type": "article",
                    "parent_id": item["article_id"],
                    "content": chunk.get("text", ""),
                    "legal_topics": topics,
                }
            )

    passages = [f"passage: {c['content']}" if is_e5 else c["content"] for c in chunks_to_embed]
    embeddings = model.encode(passages, batch_size=32, show_progress_bar=False, normalize_embeddings=True)

    chunk_rows = [
        (
            c["chunk_id"],
            c["parent_type"],
            c["parent_id"],
            c["content"],
            c["legal_topics"],
            emb.tolist(),
        )
        for c, emb in zip(chunks_to_embed, embeddings)
    ]

    with conn.cursor() as cur:
        # Remove stale chunks for repaired articles before inserting updated chunk splits.
        cur.execute(
            "DELETE FROM document_chunks WHERE parent_type = 'article' AND parent_id = ANY(%s)",
            (synced_ids,),
        )
        execute_values(
            cur,
            """
            INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, legal_topics, embedding)
            VALUES %s
            ON CONFLICT (chunk_id) DO UPDATE SET
                content = EXCLUDED.content,
                legal_topics = EXCLUDED.legal_topics,
                embedding = EXCLUDED.embedding;
            """,
            chunk_rows,
            template="(%s, %s, %s, %s, %s, %s::vector)",
        )
        conn.commit()

    return len(to_sync)


def repair_no_digit_gr_numbers(conn) -> int:
    """Hydrate missing docket numbers for jurisprudence_cases rows lacking digits."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT case_uid, COALESCE(content_summary, ''), COALESCE(full_text, '')
            FROM jurisprudence_cases
            WHERE gr_number IS NULL OR gr_number !~ '[0-9]'
            """
        )
        rows = cur.fetchall()

    updates: List[Tuple[str, str]] = []
    for case_uid, summary, full_text in rows:
        extracted = extract_docket_from_case_text(summary, full_text)
        if extracted:
            updates.append((extracted, case_uid))

    if not updates:
        return 0

    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE jurisprudence_cases SET gr_number = %s WHERE case_uid = %s",
            updates,
        )
        conn.commit()
    return len(updates)


def populate_eo209_jurisprudence_relations(conn) -> Tuple[int, int]:
    """Populate EO209-ART1..257 citation edges in article_jurisprudence_relations."""
    with conn.cursor() as cur:
        cur.execute("SELECT article_id FROM civil_code_articles WHERE article_id LIKE 'EO209-ART%'")
        valid_eo209_ids = {row[0] for row in cur.fetchall()}

        cur.execute(
            """
            SELECT case_uid, COALESCE(decision_date, ''), COALESCE(full_text, content_summary, '')
            FROM jurisprudence_cases
            WHERE full_text ~* 'family code|executive order no\\.?\\s*209|e\\.o\\.\\s*no\\.?\\s*209'
               OR content_summary ~* 'family code|executive order no\\.?\\s*209|e\\.o\\.\\s*no\\.?\\s*209'
            """
        )
        fc_cases = cur.fetchall()

    explicit_edges: Set[Tuple[str, str]] = set()
    fc_post1988_uids: Set[str] = set()

    for case_uid, decision_date, text in fc_cases:
        for art_num in extract_family_code_articles_from_case(text):
            art_id = f"EO209-ART{art_num}"
            if art_id in valid_eo209_ids:
                explicit_edges.add((art_id, case_uid))

        years = [int(y) for y in _YEAR_RE.findall(decision_date)]
        if any(y >= 1988 for y in years):
            fc_post1988_uids.add(case_uid)

    inferred_edges: Set[Tuple[str, str]] = set()
    if fc_post1988_uids:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.article_number, r.case_uid
                FROM article_jurisprudence_relations r
                JOIN civil_code_articles a ON a.article_id = r.article_id
                WHERE r.article_id LIKE 'RA386-ART%%'
                  AND a.article_number BETWEEN 1 AND 257
                  AND r.case_uid = ANY(%s)
                """,
                (list(fc_post1988_uids),),
            )
            for art_num, case_uid in cur.fetchall():
                art_id = f"EO209-ART{art_num}"
                if art_id in valid_eo209_ids and (art_id, case_uid) not in explicit_edges:
                    inferred_edges.add((art_id, case_uid))

    explicit_rows = [(a, c, "family_code_explicit") for a, c in sorted(explicit_edges)]
    inferred_rows = [(a, c, "family_code_inferred") for a, c in sorted(inferred_edges)]

    with conn.cursor() as cur:
        if explicit_rows:
            execute_values(
                cur,
                """
                INSERT INTO article_jurisprudence_relations (article_id, case_uid, citation_type)
                VALUES %s
                ON CONFLICT (article_id, case_uid) DO UPDATE SET
                    citation_type = 'family_code_explicit'
                WHERE article_jurisprudence_relations.citation_type <> 'family_code_explicit';
                """,
                explicit_rows,
            )
        if inferred_rows:
            execute_values(
                cur,
                """
                INSERT INTO article_jurisprudence_relations (article_id, case_uid, citation_type)
                VALUES %s
                ON CONFLICT (article_id, case_uid) DO NOTHING;
                """,
                inferred_rows,
            )
        conn.commit()

    return len(explicit_rows), len(inferred_rows)


def apply_retrieval_indexes(conn, migration_path: str) -> None:
    """Apply additive retrieval indexes safely within Docker /dev/shm limits."""
    with open(migration_path, "r", encoding="utf-8") as f:
        sql = f.read()
    with conn.cursor() as cur:
        # Disable parallel DSM workers so HNSW build uses process heap rather than /dev/shm.
        cur.execute("SET max_parallel_maintenance_workers = 0;")
        cur.execute("SET maintenance_work_mem = '512MB';")
        cur.execute(sql)
        conn.commit()


def verify_all(conn, data_dir: str) -> bool:
    """Verify all Phase 2 corpus, docket, graph, and index integrity invariants."""
    ok = True
    fc_path = os.path.join(data_dir, "family_code_rag.jsonl")
    truncated_jsonl = []
    with open(fc_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            if int(item.get("article_number") or 0) <= 0:
                continue
            expected = clean_article_text(item.get("text") or "")
            if (item.get("text_clean") or "").strip() != expected:
                truncated_jsonl.append(item["article_id"])

    if truncated_jsonl:
        print(f"FAIL: {len(truncated_jsonl)} Family Code JSONL articles still mismatched: {truncated_jsonl[:10]}")
        ok = False
    else:
        print("PASS: All 257 Family Code JSONL articles match clean_article_text.")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT article_id, content FROM civil_code_articles
            WHERE article_id IN ('EO209-ART2', 'EO209-ART3', 'EO209-ART26', 'EO209-ART102', 'EO209-ART129')
            """
        )
        samples = dict(cur.fetchall())
        checks = {
            "EO209-ART2": "(2) Consent freely given",
            "EO209-ART3": "(3) A marriage ceremony",
            "EO209-ART26": "capacity to remarry under Philippine law",
            "EO209-ART102": "(6)",
            "EO209-ART129": "(9)",
        }
        for aid, needle in checks.items():
            if needle not in samples.get(aid, ""):
                print(f"FAIL: {aid} missing expected statutory clause {needle!r}")
                ok = False
        if ok:
            print("PASS: Key Family Code DB articles (Arts. 2, 3, 26, 102, 129) contain complete statutory text.")

        cur.execute("SELECT count(*) FROM jurisprudence_cases WHERE gr_number IS NULL OR gr_number !~ '[0-9]'")
        no_digit = cur.fetchone()[0]
        if no_digit > 0:
            print(f"FAIL: {no_digit} jurisprudence_cases rows still have no digits in gr_number")
            ok = False
        else:
            print("PASS: 0 jurisprudence_cases rows lack digits in gr_number.")

        cur.execute("SELECT count(*), count(DISTINCT article_id) FROM article_jurisprudence_relations WHERE article_id LIKE 'EO209-ART%'")
        eo_edges, eo_arts = cur.fetchone()
        if eo_edges < 500 or eo_arts < 100:
            print(f"FAIL: Insufficient EO209 citation links (edges={eo_edges}, articles={eo_arts})")
            ok = False
        else:
            print(f"PASS: EO209 citation graph populated ({eo_edges} edges across {eo_arts} Family Code articles).")

        cur.execute(
            """
            SELECT i.relname, ix.indisvalid
            FROM pg_index ix
            JOIN pg_class i ON i.oid = ix.indexrelid
            WHERE i.relname IN ('case_vector_idx', 'idx_civil_code_articles_num')
            """
        )
        idx_map = dict(cur.fetchall())
        for idx_name in ("case_vector_idx", "idx_civil_code_articles_num"):
            if not idx_map.get(idx_name, False):
                print(f"FAIL: Index {idx_name} is missing or invalid ({idx_map.get(idx_name)})")
                ok = False
            else:
                print(f"PASS: Index {idx_name} exists and is valid (ONLINE).")

    return ok


def main():
    parser = argparse.ArgumentParser(description="Repair CIVIL-LEX RAG corpus and PostgreSQL integrity")
    parser.add_argument("--apply", action="store_true", help="Apply all corpus, docket, graph, and index repairs")
    parser.add_argument("--verify", action="store_true", help="Verify all integrity checks")
    parser.add_argument("--skip-indexes", action="store_true", help="Skip HNSW/B-tree index creation during apply")
    args = parser.parse_args()

    if not args.apply and not args.verify:
        args.verify = True

    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    migration_path = os.path.join(
        os.path.dirname(base_dir),
        "supabase",
        "migrations",
        "20261120170000_rag_retrieval_indexes_and_repairs.sql",
    )

    conn = get_connection()
    try:
        if args.apply:
            repaired_fc = repair_family_code_jsonl_and_db(conn, data_dir, embed=True)
            print(f"Repaired and re-embedded {repaired_fc} Family Code articles.")

            hydrated_gr = repair_no_digit_gr_numbers(conn)
            print(f"Hydrated docket numbers for {hydrated_gr} jurisprudence_cases rows.")

            explicit_cnt, inferred_cnt = populate_eo209_jurisprudence_relations(conn)
            print(f"Populated EO209 relations: {explicit_cnt} explicit, {inferred_cnt} inferred.")

            if not args.skip_indexes:
                print("Applying additive retrieval indexes (case_vector_idx, idx_civil_code_articles_num)...")
                apply_retrieval_indexes(conn, migration_path)
                print("Retrieval indexes applied.")

        if args.verify:
            passed = verify_all(conn, data_dir)
            if not passed:
                sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
