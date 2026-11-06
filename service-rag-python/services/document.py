import os
import io
import pymupdf as fitz  # PyMuPDF
import pytesseract
from PIL import Image
import httpx
import psycopg2

# Configure Tesseract binary path if local wrapper exists
LOCAL_TESSERACT = '/home/rencehp/.local/bin/tesseract'
if os.path.exists(LOCAL_TESSERACT):
    pytesseract.pytesseract.tesseract_cmd = LOCAL_TESSERACT

try:
    import docx
except ImportError:
    docx = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

from dotenv import load_dotenv
load_dotenv()

DEFAULT_DB_URL = os.getenv("POSTGRES_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")

# Lazy load model
_model = None
def get_model():
    global _model
    if _model is None and SentenceTransformer is not None:
        print(f"Loading embedding model ({EMBEDDING_MODEL_NAME})...")
        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model

def chunk_text(text: str, chunk_size: int = 300, overlap: int = 50):
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += chunk_size - overlap
    return chunks

def init_document_table():
    """Ensure user_documents table supports error_message, canvas editing, and all status states."""
    try:
        conn = psycopg2.connect(DEFAULT_DB_URL)
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS error_message TEXT;")
            cur.execute("ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;")
            cur.execute("ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS canvas_content TEXT;")
            cur.execute("ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS canvas_html TEXT;")
            cur.execute("ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS canvas_updated_at TIMESTAMPTZ DEFAULT NOW();")
            cur.execute("""
                DO $$
                BEGIN
                    ALTER TABLE user_documents DROP CONSTRAINT IF EXISTS user_documents_status_check;
                    ALTER TABLE user_documents ADD CONSTRAINT user_documents_status_check 
                        CHECK (status = ANY (ARRAY['uploading'::text, 'extracting'::text, 'completed'::text, 'rejected_unrelated'::text, 'error'::text]));
                EXCEPTION
                    WHEN OTHERS THEN NULL;
                END $$;
            """)
            conn.commit()
            conn.close()
    except Exception as e:
        print(f"init_document_table note: {e}")

# Run schema initialization once on import
init_document_table()

def update_status(document_id: str, status: str, error_message: str = None):
    try:
        conn = psycopg2.connect(DEFAULT_DB_URL)
        with conn.cursor() as cur:
            if error_message is not None:
                cur.execute(
                    "UPDATE user_documents SET status = %s, error_message = %s WHERE id = %s",
                    (status, error_message, document_id)
                )
            else:
                cur.execute(
                    "UPDATE user_documents SET status = %s WHERE id = %s",
                    (status, document_id)
                )
            conn.commit()
            conn.close()
    except Exception as e:
        print(f"Failed to update status to {status} for {document_id}: {e}")

def extract_pdf_structured_text(file_bytes: bytes) -> str:
    """Extracts PDF text preserving paragraphs, headers, and section structure."""
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        pages_text = []
        for page in doc:
            blocks = page.get_text("blocks")
            page_paragraphs = []
            for b in blocks:
                if len(b) > 4 and b[4] and (len(b) <= 6 or b[6] == 0):
                    raw_block = b[4].strip()
                    if not raw_block:
                        continue
                    lines = [line.strip() for line in raw_block.splitlines() if line.strip()]
                    if not lines:
                        continue
                    first_line = lines[0]
                    if len(lines) == 1 and (first_line.isupper() or (len(first_line) < 70 and first_line.endswith(":"))):
                        page_paragraphs.append(f"### {first_line}")
                    else:
                        joined_para = " ".join(lines)
                        page_paragraphs.append(joined_para)
            if page_paragraphs:
                pages_text.append("\n\n".join(page_paragraphs))
        return "\n\n".join(pages_text)


def extract_docx_structured_text(file_bytes: bytes) -> str:
    """Extracts DOCX text preserving markdown headings, bold clauses, lists, and tables."""
    if not docx:
        return ""
    doc = docx.Document(io.BytesIO(file_bytes))
    paragraphs = []
    for para in doc.paragraphs:
        p_text = para.text.strip()
        if not p_text:
            continue
        style_name = (para.style.name or "").lower() if para.style else ""
        if "heading 1" in style_name or "title" in style_name:
            paragraphs.append(f"# {p_text}")
        elif "heading 2" in style_name:
            paragraphs.append(f"## {p_text}")
        elif "heading 3" in style_name:
            paragraphs.append(f"### {p_text}")
        else:
            has_bold = any(r.bold for r in para.runs if r.text and r.text.strip())
            if has_bold and len(para.runs) > 1:
                run_text = ""
                for r in para.runs:
                    txt = r.text
                    if not txt:
                        continue
                    if r.bold and txt.strip():
                        run_text += f"**{txt}**"
                    else:
                        run_text += txt
                paragraphs.append(run_text.strip())
            elif p_text.isupper() and len(p_text) < 70:
                paragraphs.append(f"### {p_text}")
            else:
                paragraphs.append(p_text)

    for table in doc.tables:
        table_rows = []
        for row in table.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            if any(cells):
                table_rows.append("| " + " | ".join(cells) + " |")
        if table_rows:
            if len(table_rows) > 1:
                header_sep = "| " + " | ".join(["---"] * len(table.columns)) + " |"
                table_rows.insert(1, header_sep)
            paragraphs.append("\n".join(table_rows))

    return "\n\n".join(paragraphs)


def extract_and_process_document(file_url: str, document_id: str, filename: str):
    print(f"Starting extraction for document {document_id} ({filename}) from {file_url}")
    update_status(document_id, 'extracting')
    
    # 1. Download file with explicit timeout
    try:
        response = httpx.get(file_url, timeout=35.0)
        response.raise_for_status()
        file_bytes = response.content
    except httpx.TimeoutException:
        print(f"Download timed out for {file_url}")
        update_status(document_id, 'error', "Document download timed out. Please try uploading again.")
        return
    except Exception as e:
        print(f"Failed to download {file_url}: {e}")
        update_status(document_id, 'error', f"Failed to download document: {str(e)}")
        return

    text = ""
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    is_image = ext in ['png', 'jpg', 'jpeg']
    
    # 2. Extract text with format-specific handling and timeouts
    try:
        if ext == 'pdf':
            text = extract_pdf_structured_text(file_bytes)
            
            # Fallback to Tesseract OCR if extracted text is minimal (e.g. scanned image-based PDF)
            if len(text.strip()) < 100:
                print("PDF text is minimal (<100 chars), running OCR fallback...")
                text = ""
                with fitz.open(stream=file_bytes, filetype="pdf") as doc:
                    max_pages = min(len(doc), 15)
                    for i in range(max_pages):
                        try:
                            pix = doc[i].get_pixmap(dpi=150)
                            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                            page_text = pytesseract.image_to_string(img, timeout=20)
                            text += page_text + "\n\n"
                        except pytesseract.pytesseract.TesseractTimeoutError:
                            print(f"PDF OCR page {i+1} timed out, skipping")
                        except Exception as page_err:
                            print(f"PDF OCR page {i+1} failed: {page_err}")

        elif is_image:
            print("Extracting text from image using OCR...")
            try:
                img = Image.open(io.BytesIO(file_bytes))
            except Exception as img_err:
                print(f"Failed to open image: {img_err}")
                update_status(document_id, 'error', "Invalid or corrupted image file.")
                return

            # Downsample ultra-high-resolution images to max 2200px to avoid extreme OCR latency
            MAX_DIM = 2200
            if max(img.width, img.height) > MAX_DIM:
                scale = MAX_DIM / max(img.width, img.height)
                new_size = (int(img.width * scale), int(img.height * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)

            # Ensure proper RGB mode (handle transparency in RGBA / Palette)
            if img.mode == 'RGBA':
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            try:
                # 25-second timeout for image OCR
                text = pytesseract.image_to_string(img, timeout=25)
            except pytesseract.pytesseract.TesseractTimeoutError:
                print(f"Image OCR timed out after 25s for document {document_id}")
                update_status(document_id, 'rejected_unrelated', "Image OCR timed out. The image could not be parsed for text in time.")
                return
            except pytesseract.pytesseract.TesseractNotFoundError:
                print("Tesseract binary not found.")
                update_status(document_id, 'error', "OCR engine is not installed on the system. Please upload a PDF or Word document.")
                return
            except Exception as ocr_err:
                print(f"OCR error for document {document_id}: {ocr_err}")
                update_status(document_id, 'error', f"OCR processing failed: {str(ocr_err)}")
                return

        elif ext in ['doc', 'docx']:
            print("Extracting text from word document with structured markdown...")
            if docx:
                text = extract_docx_structured_text(file_bytes)
            else:
                print("python-docx not installed, cannot extract docx")
                update_status(document_id, 'error', "Word document extractor is not installed on the server.")
                return

        elif ext == 'txt':
            print("Extracting text from plain text file...")
            text = file_bytes.decode('utf-8', errors='ignore')

        else:
            print(f"Unsupported file extension: {ext}")
            update_status(document_id, 'error', f"Unsupported file format: .{ext}")
            return
            
    except Exception as e:
        print(f"Failed to extract text: {e}")
        update_status(document_id, 'error', f"Extraction failed: {str(e)}")
        return

    # 3. Detect if there is no text or insufficient alphanumeric content
    clean_text = text.strip()
    alnum_chars = sum(1 for c in clean_text if c.isalnum())

    if alnum_chars < 15:
        msg = (
            "No readable text could be detected in this image. Please ensure the image is clear and contains legible text, or upload a document."
            if is_image
            else "No readable text could be extracted from this document. Please ensure the file contains legible text."
        )
        print(f"Insufficient text extracted ({alnum_chars} alphanumeric chars), marking rejected: {msg}")
        update_status(document_id, 'rejected_unrelated', msg)
        return

    # 4. Chunk text and generate vector embeddings
    chunks = chunk_text(text, chunk_size=350, overlap=50)
    if not chunks:
        update_status(document_id, 'rejected_unrelated', "Document contains insufficient text to form analytical chunks.")
        return

    model = get_model()
    if not model:
        print("SentenceTransformer model not available. Marking as error.")
        update_status(document_id, 'error', "Vector embedding model unavailable.")
        return

    try:
        from psycopg2.extras import execute_values

        conn = psycopg2.connect(DEFAULT_DB_URL)
        total_chunks = len(chunks)
        batch_size = 16
        last_progress = 0

        with conn.cursor() as cur:
            for batch_start in range(0, total_chunks, batch_size):
                batch_chunks = chunks[batch_start:batch_start + batch_size]
                passages = [
                    f"passage: {c}" if "e5" in EMBEDDING_MODEL_NAME.lower() else c
                    for c in batch_chunks
                ]
                embeddings = model.encode(passages, batch_size=batch_size, normalize_embeddings=True).tolist()

                rows = [
                    (
                        f"{document_id}_c{batch_start + idx}",
                        "user_document",
                        document_id,
                        batch_chunks[idx],
                        embeddings[idx],
                    )
                    for idx in range(len(batch_chunks))
                ]

                execute_values(
                    cur,
                    """
                    INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, embedding)
                    VALUES %s
                    ON CONFLICT (chunk_id) DO NOTHING;
                    """,
                    rows,
                    template="(%s, %s, %s, %s, %s::vector)",
                )

                current_count = min(batch_start + len(batch_chunks), total_chunks)
                progress_percent = int((current_count / total_chunks) * 100)
                if progress_percent - last_progress >= 20 or current_count == total_chunks:
                    cur.execute(
                        "UPDATE user_documents SET progress = %s WHERE id = %s;",
                        (progress_percent, document_id),
                    )
                    conn.commit()
                    last_progress = progress_percent

            cur.execute(
                """
                UPDATE user_documents 
                SET status = 'completed', progress = 100, error_message = NULL,
                    extracted_text = %s,
                    canvas_content = COALESCE(canvas_content, %s),
                    canvas_updated_at = NOW()
                WHERE id = %s;
                """,
                (clean_text, clean_text, document_id),
            )
            conn.commit()
            print(f"Successfully processed and embedded {total_chunks} chunks for {document_id}")
    except Exception as e:
        print(f"Database error during extraction: {e}")
        update_status(document_id, 'error', f"Database error during chunk embedding: {str(e)}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()


def reindex_document_text(document_id: str, new_text: str) -> dict:
    """Re-chunks and re-embeds updated canvas document text in PostgreSQL."""
    clean_text = (new_text or "").strip()
    if not clean_text:
        return {"status": "error", "message": "Document text is empty"}

    chunks = chunk_text(clean_text, chunk_size=350, overlap=50)
    if not chunks:
        return {"status": "error", "message": "No chunks generated"}

    model = get_model()
    if not model:
        return {"status": "error", "message": "Embedding model unavailable"}

    conn = psycopg2.connect(DEFAULT_DB_URL)
    try:
        from psycopg2.extras import execute_values
        with conn.cursor() as cur:
            # Remove previous chunks for this user document
            cur.execute("DELETE FROM document_chunks WHERE parent_id = %s AND parent_type = 'user_document';", (document_id,))
            
            total_chunks = len(chunks)
            batch_size = 16
            for batch_start in range(0, total_chunks, batch_size):
                batch_chunks = chunks[batch_start:batch_start + batch_size]
                passages = [
                    f"passage: {c}" if "e5" in EMBEDDING_MODEL_NAME.lower() else c
                    for c in batch_chunks
                ]
                embeddings = model.encode(passages, batch_size=batch_size, normalize_embeddings=True).tolist()
                rows = [
                    (
                        f"{document_id}_c{batch_start + idx}",
                        "user_document",
                        document_id,
                        batch_chunks[idx],
                        embeddings[idx],
                    )
                    for idx in range(len(batch_chunks))
                ]
                execute_values(
                    cur,
                    """
                    INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, embedding)
                    VALUES %s
                    ON CONFLICT (chunk_id) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding;
                    """,
                    rows,
                    template="(%s, %s, %s, %s, %s::vector)",
                )

            # Update document canvas metadata
            cur.execute(
                """
                UPDATE user_documents 
                SET canvas_content = %s, canvas_updated_at = NOW() 
                WHERE id = %s;
                """,
                (clean_text, document_id),
            )
            conn.commit()
            print(f"Re-indexed {total_chunks} chunks for document {document_id}")
            return {"status": "completed", "total_chunks": total_chunks}
    except Exception as e:
        print(f"Error re-indexing document {document_id}: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()
