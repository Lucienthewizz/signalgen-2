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


def test_password_reset_request_uses_configured_redirect(monkeypatch):
    reset_password_for_email = Mock()
    monkeypatch.setattr(
        dependencies.supabase.auth,
        "reset_password_for_email",
        reset_password_for_email,
    )

    response = client.post(
        "/api/auth/password/reset-request",
        json={"email": " demo@example.com "},
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "If the account exists, password reset instructions have been sent."
    }
    reset_password_for_email.assert_called_once()
    assert reset_password_for_email.call_args.args[0] == "demo@example.com"
    assert "redirect_to" in reset_password_for_email.call_args.args[1]


def test_password_reset_request_reports_provider_failure(monkeypatch):
    reset_password_for_email = Mock(side_effect=Exception("provider unavailable"))
    monkeypatch.setattr(
        dependencies.supabase.auth,
        "reset_password_for_email",
        reset_password_for_email,
    )

    response = client.post(
        "/api/auth/password/reset-request",
        json={"email": "demo@example.com"},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Password recovery is temporarily unavailable."
    }


def test_password_reset_confirms_recovery_session(monkeypatch):
    auth = SimpleNamespace(
        set_session=Mock(),
        update_user=Mock(return_value=SimpleNamespace(user=SimpleNamespace(id="user-1"))),
    )
    monkeypatch.setattr(
        "app.app.create_auth_client",
        Mock(return_value=SimpleNamespace(auth=auth)),
    )

    response = client.post(
        "/api/auth/password/reset",
        json={
            "access_token": "recovery-access",
            "refresh_token": "recovery-refresh",
            "password": "new-secret-123",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Password updated successfully."}
    auth.set_session.assert_called_once_with("recovery-access", "recovery-refresh")
    auth.update_user.assert_called_once_with({"password": "new-secret-123"})


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
