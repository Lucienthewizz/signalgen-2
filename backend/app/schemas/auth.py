"""Request schemas for authentication endpoints."""

from pydantic import BaseModel, Field


class AuthLogin(BaseModel):
    """Credentials used to start a Supabase Auth session."""

    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=1024)


class AuthRegister(BaseModel):
    """Credentials used to create a Supabase Auth account."""

    full_name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=1024)
