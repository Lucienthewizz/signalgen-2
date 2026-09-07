from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.app import app
from app.auth import dependencies


client = TestClient(app)


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
