import os
import io
import fitz # PyMuPDF
import pytesseract
from PIL import Image
import httpx
import psycopg2

try:
    import docx
except ImportError:
    docx = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

DEFAULT_DB_URL = os.getenv("POSTGRES_DB_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
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
    # Basic word-level sliding window chunker
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += chunk_size - overlap
    return chunks

def update_status(document_id: str, status: str):
    try:
        conn = psycopg2.connect(DEFAULT_DB_URL)
        with conn.cursor() as cur:
            cur.execute("UPDATE user_documents SET status = %s WHERE id = %s", (status, document_id))
            conn.commit()
            conn.close()
    except Exception as e:
        print(f"Failed to update status to {status} for {document_id}: {e}")

def extract_and_process_document(file_url: str, document_id: str, filename: str):
    print(f"Starting extraction for document {document_id} ({filename}) from {file_url}")
    update_status(document_id, 'extracting')
    
    try:
        response = httpx.get(file_url)
        response.raise_for_status()
        file_bytes = response.content
    except Exception as e:
        print(f"Failed to download {file_url}: {e}")
        update_status(document_id, 'error')
        return

    text = ""
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    
    try:
        if ext == 'pdf':
            with fitz.open(stream=file_bytes, filetype="pdf") as doc:
                for page in doc:
                    text += page.get_text()
                
                # Fallback to Tesseract OCR if text is very short (image-based PDF)
                if len(text.strip()) < 100:
                    print("Text too short, attempting OCR fallback...")
                    text = ""
                    for page in doc:
                        pix = page.get_pixmap(dpi=150)
                        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                        text += pytesseract.image_to_string(img)
        elif ext in ['png', 'jpg', 'jpeg']:
            print("Extracting text from image using OCR...")
            img = Image.open(io.BytesIO(file_bytes))
            if img.mode == 'RGBA':
                # Convert transparent background to white
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            else:
                img = img.convert('RGB')
            text = pytesseract.image_to_string(img)
        elif ext in ['doc', 'docx']:
            print("Extracting text from word document...")
            if docx:
                doc = docx.Document(io.BytesIO(file_bytes))
                for para in doc.paragraphs:
                    text += para.text + "\n"
            else:
                print("python-docx not installed, cannot extract docx")
        elif ext == 'txt':
            print("Extracting text from plain text file...")
            text = file_bytes.decode('utf-8', errors='ignore')
        else:
            print(f"Unsupported file extension: {ext}")
            
    except Exception as e:
        print(f"Failed to extract text: {e}")
        update_status(document_id, 'error')
        return

    if len(text.strip()) == 0:
        print("No text extracted, marking rejected")
        update_status(document_id, 'rejected_unrelated')
        return

    chunks = chunk_text(text, chunk_size=350, overlap=50) 
    model = get_model()
    
    if not model:
        print("SentenceTransformer model not available. Marking as error.")
        update_status(document_id, 'error')
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
                
                # Update progress every 5 chunks or on the last chunk to avoid hammering the DB
                if (i + 1) % 5 == 0 or (i + 1) == total_chunks:
                    progress_percent = int(((i + 1) / total_chunks) * 100)
                    cur.execute("UPDATE user_documents SET progress = %s WHERE id = %s", (progress_percent, document_id))
                    conn.commit()
            
            cur.execute("UPDATE user_documents SET status = 'completed', progress = 100 WHERE id = %s", (document_id,))
            conn.commit()
            print(f"Successfully processed and embedded {total_chunks} chunks for {document_id}")
    except Exception as e:
        print(f"Database error during extraction: {e}")
        update_status(document_id, 'error')
    finally:
        if 'conn' in locals() and conn:
            conn.close()
