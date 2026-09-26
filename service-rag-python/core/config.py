import os
from pathlib import Path
from dotenv import load_dotenv

# 1. Load root-level unified .env if available
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
root_env_path = ROOT_DIR / ".env"
if root_env_path.exists():
    load_dotenv(root_env_path, override=False)

# 2. Load service-specific .env (overriding defaults if defined locally)
service_env_path = Path(__file__).resolve().parent.parent / ".env"
if service_env_path.exists():
    load_dotenv(service_env_path, override=True)
else:
    load_dotenv(override=True)

POSTGRES_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)

# LM Studio default URL (OpenAI Compatible)
LM_STUDIO_URL = os.getenv("LM_STUDIO_URL", "http://10.57.24.131:1234/v1")

# Concurrency & Queue Policy (Unified Settings)
# Strict limit: 1 concurrent query for 6GB VRAM GPUs (prevents CUDA OOM and thrashing)
MAX_CONCURRENT_QUERIES = int(os.getenv("MAX_CONCURRENT_QUERIES", "1"))
MAX_QUEUE_SIZE = int(os.getenv("MAX_QUEUE_SIZE", "50"))
QUEUE_TIMEOUT_SECONDS = float(os.getenv("QUEUE_TIMEOUT_SECONDS", "180.0"))
