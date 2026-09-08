from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.app import app
from app.auth import dependencies


client = TestClient(app)


def test_auth_register_returns_session_when_confirmation_is_disabled(monkeypatch):
    user = SimpleNamespace(id="user-456", email="new@example.com")
    session = SimpleNamespace(access_token="new-access-token")
    sign_up = Mock(return_value=SimpleNamespace(user=user, session=session))
    monkeypatch.setattr(dependencies.supabase.auth, "sign_up", sign_up)

    response = client.post(
        "/api/auth/register",
        json={
            "full_name": " New User ",
            "email": " new@example.com ",
            "password": "secret123",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "Registration successful.",
        "requires_email_confirmation": False,
        "access_token": "new-access-token",
        "user": {
            "id": "user-456",
            "email": "new@example.com",
            "full_name": "New User",
        },
    }
    sign_up.assert_called_once_with(
        {
            "email": "new@example.com",
            "password": "secret123",
            "options": {"data": {"full_name": "New User"}},
        }
    )


def test_auth_register_requests_confirmation_when_session_is_missing(monkeypatch):
    user = SimpleNamespace(id="user-789", email="confirm@example.com")
    sign_up = Mock(return_value=SimpleNamespace(user=user, session=None))
    monkeypatch.setattr(dependencies.supabase.auth, "sign_up", sign_up)

    response = client.post(
        "/api/auth/register",
        json={
            "full_name": "Confirm User",
            "email": "confirm@example.com",
            "password": "secret123",
        },
    )

    assert response.status_code == 200
    assert response.json()["requires_email_confirmation"] is True
    assert response.json()["access_token"] is None


def test_auth_register_rejects_failed_signup(monkeypatch):
    sign_up = Mock(side_effect=Exception("signup failed"))
    monkeypatch.setattr(dependencies.supabase.auth, "sign_up", sign_up)

    response = client.post(
        "/api/auth/register",
        json={
            "full_name": "New User",
            "email": "new@example.com",
            "password": "secret123",
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Registration failed. Check your data and try again."
    }


def test_auth_login_returns_access_token(monkeypatch):
    user = SimpleNamespace(
        id="user-123",
        email="lucien@example.com",
        user_metadata={"full_name": "Lucien"},
    )
    session = SimpleNamespace(access_token="access-token", expires_in=3600)
    sign_in = Mock(return_value=SimpleNamespace(user=user, session=session))
    monkeypatch.setattr(dependencies.supabase.auth, "sign_in_with_password", sign_in)

    response = client.post(
        "/api/auth/login",
        json={"email": " lucien@example.com ", "password": "secret"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "access_token": "access-token",
        "token_type": "bearer",
        "expires_in": 3600,
        "user": {
            "id": "user-123",
            "email": "lucien@example.com",
            "full_name": "Lucien",
        },
    }
    sign_in.assert_called_once_with(
        {"email": "lucien@example.com", "password": "secret"}
    )


def test_auth_login_rejects_invalid_credentials(monkeypatch):
    sign_in = Mock(side_effect=Exception("invalid credentials"))
    monkeypatch.setattr(dependencies.supabase.auth, "sign_in_with_password", sign_in)

    response = client.post(
        "/api/auth/login",
        json={"email": "lucien@example.com", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_auth_me_rejects_request_without_bearer_token():
    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}


def test_auth_me_rejects_invalid_bearer_token(monkeypatch):
    get_user = Mock(side_effect=Exception("invalid token"))
    monkeypatch.setattr(dependencies.supabase.auth, "get_user", get_user)

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or expired token"}
    get_user.assert_called_once_with("invalid-token")


def test_auth_me_returns_authenticated_user(monkeypatch):
    user = SimpleNamespace(
        id="user-123",
        email="lucien@example.com",
        user_metadata={"full_name": "Lucien"},
    )
    get_user = Mock(return_value=SimpleNamespace(user=user))
    monkeypatch.setattr(dependencies.supabase.auth, "get_user", get_user)

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "user-123",
        "email": "lucien@example.com",
        "full_name": "Lucien",
    }
    get_user.assert_called_once_with("valid-token")
