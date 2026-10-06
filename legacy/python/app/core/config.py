import os
from pathlib import Path

from dotenv import load_dotenv


# Keep the existing server-only configuration in place; never copy secrets
# into the archive or renderer. Docker supplies these variables directly.
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
load_dotenv(REPOSITORY_ROOT / "backend" / ".env")


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")


if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL belum dikonfigurasi di .env")

if not SUPABASE_PUBLISHABLE_KEY:
    raise RuntimeError(
        "SUPABASE_PUBLISHABLE_KEY belum dikonfigurasi di .env"
    )
