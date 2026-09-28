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
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/stsb-xlm-r-multilingual")

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
    """Ensure user_documents table supports error_message and all status states."""
    try:
        conn = psycopg2.connect(DEFAULT_DB_URL)
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS error_message TEXT;")
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
            with fitz.open(stream=file_bytes, filetype="pdf") as doc:
                for page in doc:
                    text += page.get_text()
                
                # Fallback to Tesseract OCR if extracted text is minimal (e.g. scanned image-based PDF)
                if len(text.strip()) < 100:
                    print("PDF text is minimal (<100 chars), running OCR fallback...")
                    text = ""
                    # Cap OCR to first 15 pages to guarantee reasonable turnaround
                    max_pages = min(len(doc), 15)
                    for i in range(max_pages):
                        try:
                            pix = doc[i].get_pixmap(dpi=150)
                            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                            page_text = pytesseract.image_to_string(img, timeout=20)
                            text += page_text + "\n"
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
            print("Extracting text from word document...")
            if docx:
                doc = docx.Document(io.BytesIO(file_bytes))
                for para in doc.paragraphs:
                    text += para.text + "\n"
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
        conn = psycopg2.connect(DEFAULT_DB_URL)
        total_chunks = len(chunks)
        with conn.cursor() as cur:
            for i, chunk in enumerate(chunks):
                chunk_id = f"{document_id}_c{i}"
                embedding = model.encode(chunk, normalize_embeddings=True).tolist()
                cur.execute("""
                    INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, embedding)
                    VALUES (%s, 'user_document', %s, %s, %s::vector)
                    ON CONFLICT (chunk_id) DO NOTHING;
                """, (chunk_id, document_id, chunk, embedding))
                
                # Update progress every 5 chunks or on the last chunk
                if (i + 1) % 5 == 0 or (i + 1) == total_chunks:
                    progress_percent = int(((i + 1) / total_chunks) * 100)
                    cur.execute("UPDATE user_documents SET progress = %s WHERE id = %s", (progress_percent, document_id))
                    conn.commit()
            
            cur.execute("UPDATE user_documents SET status = 'completed', progress = 100, error_message = NULL WHERE id = %s", (document_id,))
            conn.commit()
            print(f"Successfully processed and embedded {total_chunks} chunks for {document_id}")
    except Exception as e:
        print(f"Database error during extraction: {e}")
        update_status(document_id, 'error', f"Database error during chunk embedding: {str(e)}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()
