from supabase import Client, create_client

from app.core.config import (
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL,
)


supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
)


def create_auth_client() -> Client:
    """Create an isolated auth client for one recovery session."""
    return create_client(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
