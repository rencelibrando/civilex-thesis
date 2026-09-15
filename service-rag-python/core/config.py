import os
from dotenv import load_dotenv

load_dotenv(override=True)

POSTGRES_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)

# LM Studio default URL (OpenAI Compatible)
LM_STUDIO_URL = os.getenv("LM_STUDIO_URL", "http://127.0.0.1:1234/v1")

# Gemini Fallback key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
