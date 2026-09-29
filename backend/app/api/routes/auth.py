"""Authentication HTTP endpoints backed by Supabase Auth."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.db.supabase_client import supabase
from app.schemas.auth import AuthLogin, AuthRegister


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
def register(credentials: AuthRegister):
    """Create a user through Supabase Auth."""
    try:
        response = supabase.auth.sign_up(
            {
                "email": credentials.email.strip(),
                "password": credentials.password,
                "options": {
                    "data": {"full_name": credentials.full_name.strip()}
                },
            }
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration failed. Check your data and try again.",
        )

    if response.user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration failed. Check your data and try again.",
        )

    return {
        "message": (
            "Registration successful. Check your email to confirm your account."
            if response.session is None
            else "Registration successful."
        ),
        "requires_email_confirmation": response.session is None,
        "access_token": response.session.access_token if response.session else None,
        "user": {
            "id": response.user.id,
            "email": response.user.email,
            "full_name": credentials.full_name.strip(),
        },
    }


@router.post("/login")
def login(credentials: AuthLogin):
    """Sign in through Supabase Auth."""
    try:
        response = supabase.auth.sign_in_with_password(
            {
                "email": credentials.email.strip(),
                "password": credentials.password,
            }
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if response.user is None or response.session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    return {
        "access_token": response.session.access_token,
        "token_type": "bearer",
        "expires_in": response.session.expires_in,
        "user": {
            "id": response.user.id,
            "email": response.user.email,
            "full_name": (
                response.user.user_metadata.get("full_name")
                if response.user.user_metadata
                else None
            ),
        },
    }


@router.get("/me")
def get_me(current_user=Depends(get_current_user)):
    """Get the current authenticated user's public profile fields."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": (
            current_user.user_metadata.get("full_name")
            if current_user.user_metadata
            else None
        ),
    }
