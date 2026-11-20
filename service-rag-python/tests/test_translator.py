import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from core.queue_manager import queue_manager
from services import translator


def _make_gtx_payload(translated_text: str, detected_lang: str = "en") -> list:
    return [[[translated_text, "src", None, None, 3]], None, detected_lang]


class TestTranslatorService(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        translator.clear_translation_cache()

    async def test_preserves_markdown_prefixes_tables_code_and_legal_citations(self):
        captured_calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_calls.append((dict(request.url.params), request.content.decode("utf-8")))
            form = dict(
                part.split("=", 1) for part in request.content.decode("utf-8").split("&") if "=" in part
            )
            from urllib.parse import unquote_plus

            q_text = unquote_plus(form["q"])
            # Simulate NMT translating prose and adding stray spaces inside bold markers
            translated = (
                q_text.replace("Legal Basis", "Batayang Legal")
                .replace("Under **", "Sa ilalim ng ** ")
                .replace("** of the Civil Code", " ** ng Kodigo Sibil")
                .replace("Primary Remedy:", "Pangunahing Lunas:")
                .replace("Seek help from", "Humingi ng tulong sa")
                .replace("Important Notice:", "Mahalagang Paunawa:")
                .replace("Provision", "Probisyon")
                .replace("Effect", "Epekto")
                .replace("Allows rescission", "Pinapayagan ang pagbawi")
            )
            return httpx.Response(200, json=_make_gtx_payload(translated, "en"))

        sample = (
            "### Legal Basis\n\n"
            "Under **Article 1191** of the Civil Code (R.A. 386), rescission applies [Art. 1191] "
            "and see `RA386-ART1191` plus [details](/civil-code?article=RA386-ART1191).\n\n"
            "- **Primary Remedy:** Seek help from PAO, MTC, or RTC (G.R. No. L-28602).\n"
            "1. Review E.O. 209 and Article 1156.\n\n"
            "| Provision | Effect |\n"
            "| --- | --- |\n"
            "| Article 1191 | Allows rescission |\n\n"
            "```text\n"
            "Article 1191 raw code block should never be translated\n"
            "```\n\n"
            "---\n\n"
            "> **Important Notice:** Educational information by CIVIL-LEX under R.A. 386.\n"
        )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            res = await translator.translate_legal_markdown(sample, target_lang="tl", client=client)

        self.assertEqual(len(captured_calls), 1)
        self.assertEqual(captured_calls[0][0]["client"], "gtx")
        self.assertEqual(captured_calls[0][0]["tl"], "tl")
        self.assertEqual(captured_calls[0][0]["dt"], "t")
        self.assertFalse(res["cached"])
        self.assertEqual(res["source_lang"], "en")
        self.assertEqual(res["target_lang"], "tl")

        out = res["translated_text"]
        self.assertIn("### Batayang Legal", out)
        self.assertIn("Sa ilalim ng **Article 1191** ng Kodigo Sibil (R.A. 386)", out)
        self.assertIn("[Art. 1191]", out)
        self.assertIn("`RA386-ART1191`", out)
        self.assertIn("(/civil-code?article=RA386-ART1191)", out)
        self.assertIn("- **Pangunahing Lunas:** Humingi ng tulong sa PAO, MTC, or RTC (G.R. No. L-28602).", out)
        self.assertIn("1. Review E.O. 209 and Article 1156.", out)
        self.assertIn("| Probisyon | Epekto |", out)
        self.assertIn("| --- | --- |", out)
        self.assertIn("| Article 1191 | Pinapayagan ang pagbawi |", out)
        self.assertIn("Article 1191 raw code block should never be translated", out)
        self.assertIn("\n---\n", out)
        self.assertIn("> **Mahalagang Paunawa:** Educational information by CIVIL-LEX under R.A. 386.", out)
        self.assertTrue(out.endswith("\n"))

    async def test_lru_cache_hit_skips_second_network_call(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(200, json=_make_gtx_payload("Isinalin na teksto.", "en"))

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await translator.translate_legal_markdown(
                "Translated text.", target_lang="tl", client=client
            )
            second = await translator.translate_legal_markdown(
                "Translated text.", target_lang="tl", client=client
            )

        self.assertEqual(call_count, 1)
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(first["translated_text"], second["translated_text"])

    async def test_same_explicit_source_and_target_short_circuits(self):
        called = False

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal called
            called = True
            return httpx.Response(500)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            res = await translator.translate_legal_markdown(
                "Article 1156 defines an obligation.",
                target_lang="en",
                source_lang="en",
                client=client,
            )

        self.assertFalse(called)
        self.assertEqual(res["translated_text"], "Article 1156 defines an obligation.")
        self.assertEqual(res["source_lang"], "en")

    async def test_tagalog_artikulo_normalizes_to_article_when_translating_to_english(self):
        def handler(request: httpx.Request) -> httpx.Response:
            from urllib.parse import unquote_plus

            form = dict(
                part.split("=", 1) for part in request.content.decode("utf-8").split("&") if "=" in part
            )
            q_text = unquote_plus(form["q"])
            return httpx.Response(
                200,
                json=_make_gtx_payload(q_text.replace("Ayon sa", "Under"), "fil"),
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            res = await translator.translate_legal_markdown(
                "Ayon sa Artikulo 1156 ng R.A. 386.",
                target_lang="en",
                client=client,
            )

        self.assertEqual(res["source_lang"], "tl")
        self.assertEqual(res["translated_text"], "Under Article 1156 ng R.A. 386.")

    async def test_falls_back_when_gtx_merges_batch_separators(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            from urllib.parse import unquote_plus

            form = dict(
                part.split("=", 1) for part in request.content.decode("utf-8").split("&") if "=" in part
            )
            q_text = unquote_plus(form["q"])
            if "\n\n" in q_text:
                # Simulate NMT collapsing separator newlines
                return httpx.Response(200, json=_make_gtx_payload("Merged single line", "en"))
            return httpx.Response(200, json=_make_gtx_payload(f"TL:{q_text}", "en"))

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            res = await translator.translate_legal_markdown(
                "### Heading\n- Bullet one\n- Bullet two",
                target_lang="tl",
                client=client,
            )

        self.assertEqual(call_count, 4)
        self.assertEqual(
            res["translated_text"],
            "### TL:Heading\n- TL:Bullet one\n- TL:Bullet two",
        )

    async def test_chunks_large_markdown_documents(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            from urllib.parse import unquote_plus

            form = dict(
                part.split("=", 1) for part in request.content.decode("utf-8").split("&") if "=" in part
            )
            q_text = unquote_plus(form["q"])
            return httpx.Response(200, json=_make_gtx_payload(q_text, "en"))

        lines = [f"- Clause {i}: Under Article 1156, parties must comply in good faith." + (" x" * 90) for i in range(25)]
        big_markdown = "\n".join(lines)
        self.assertGreater(len(big_markdown), translator.MAX_CHUNK_CHARS)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            res = await translator.translate_legal_markdown(big_markdown, target_lang="tl", client=client)

        self.assertGreaterEqual(call_count, 2)
        self.assertEqual(len(res["translated_text"].splitlines()), len(lines))
        self.assertTrue(all(line.startswith("- ") for line in res["translated_text"].splitlines()))

    async def test_rate_limit_raises_service_error_with_429(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429, text="Too Many Requests")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(translator.TranslationServiceError) as ctx:
                await translator.translate_legal_markdown("Hello world", target_lang="tl", client=client)
        self.assertEqual(ctx.exception.status_code, 429)


class TestTranslateFastAPIRoute(unittest.TestCase):
    def setUp(self):
        translator.clear_translation_cache()

    def test_translate_endpoint_bypasses_queue_and_validates_payload(self):
        import main as rag_main

        async def fake_translate(text: str, target_lang: str, source_lang: str = "auto"):
            return {
                "translated_text": f"[{target_lang}] {text}",
                "source_lang": "en" if target_lang == "tl" else "tl",
                "target_lang": target_lang,
                "latency_ms": 12.5,
                "cached": False,
            }

        client = TestClient(rag_main.app)
        with patch.object(rag_main, "translate_legal_markdown", side_effect=fake_translate):
            with patch.object(queue_manager, "enter_queue") as mock_queue, patch.object(
                rag_main, "generate_response_stream"
            ) as mock_llm:
                resp = client.post(
                    "/translate",
                    json={"text": "Article 1156", "target_lang": "tl", "source_lang": "auto"},
                )
                self.assertEqual(resp.status_code, 200)
                body = resp.json()
                self.assertEqual(body["translated_text"], "[tl] Article 1156")
                self.assertEqual(body["target_lang"], "tl")
                self.assertEqual(body["source_lang"], "en")
                mock_queue.assert_not_called()
                mock_llm.assert_not_called()

            bad_lang = client.post("/translate", json={"text": "Hello", "target_lang": "fr"})
            self.assertEqual(bad_lang.status_code, 422)

            blank = client.post("/translate", json={"text": "   ", "target_lang": "tl"})
            self.assertEqual(blank.status_code, 400)


if __name__ == "__main__":
    unittest.main()
