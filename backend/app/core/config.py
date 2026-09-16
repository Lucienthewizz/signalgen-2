import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")
PASSWORD_RESET_REDIRECT_URL = os.getenv(
    "PASSWORD_RESET_REDIRECT_URL",
    "http://127.0.0.1:5174/?view=reset-password",
)
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        (
            "http://localhost:3456,http://127.0.0.1:3456,"
            "http://localhost:5174,http://127.0.0.1:5174,file://"
        ),
    ).split(",")
    if origin.strip()
]


if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL belum dikonfigurasi di .env")

if not SUPABASE_PUBLISHABLE_KEY:
    raise RuntimeError(
        "SUPABASE_PUBLISHABLE_KEY belum dikonfigurasi di .env"
    )
