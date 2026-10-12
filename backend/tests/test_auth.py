from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

from .conftest import register


def test_first_user_is_admin_next_are_viewers(client):
    first = register(client, "alice")
    second = register(client, "bob")
    assert first.user["role"] == "admin"
    assert second.user["role"] == "viewer"


def test_register_duplicate_username_case_insensitive(client):
    register(client, "alice")
    r = client.post("/api/auth/register", json={"username": "ALICE", "password": "secret123"})
    assert r.status_code == 409


def test_register_validates_input(client):
    assert client.post("/api/auth/register", json={"username": "a", "password": "secret123"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "alice", "password": "123"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "bad name!", "password": "secret123"}).status_code == 422


def test_display_name_defaults_to_username(client):
    r = client.post("/api/auth/register", json={"username": "carol", "password": "secret123"})
    assert r.json()["user"]["display_name"] == "carol"


def test_login_and_me(client):
    register(client, "alice", "password1")
    r = client.post("/api/auth/login", json={"username": "Alice", "password": "password1"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "alice"


def test_login_wrong_password(client):
    register(client, "alice", "password1")
    r = client.post("/api/auth/login", json={"username": "alice", "password": "nope-nope"})
    assert r.status_code == 401
    assert client.post("/api/auth/login", json={"username": "ghost", "password": "x"}).status_code == 401


def test_requests_without_or_with_bad_token_are_rejected(client):
    assert client.get("/api/sections").status_code == 401
    assert client.get("/api/sections", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_deactivated_user_cannot_login_or_use_token(client, admin):
    bob = register(client, "bob", "password1")
    admin.patch(f"/api/users/{bob.user['id']}", json={"is_active": False})
    assert bob.get("/api/auth/me").status_code == 401
    r = client.post("/api/auth/login", json={"username": "bob", "password": "password1"})
    assert r.status_code == 403


def test_change_password(client):
    alice = register(client, "alice", "password1")
    bad = alice.post("/api/auth/change-password", json={"old_password": "wrong", "new_password": "password2"})
    assert bad.status_code == 400
    ok = alice.post("/api/auth/change-password", json={"old_password": "password1", "new_password": "password2"})
    assert ok.status_code == 204
    assert client.post("/api/auth/login", json={"username": "alice", "password": "password2"}).status_code == 200


def test_registration_can_be_disabled(settings):
    settings.allow_registration = False
    with TestClient(create_app(settings)) as c:
        r = c.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
        assert r.status_code == 403
        assert c.get("/api/site").json()["allow_registration"] is False


def test_bootstrap_admin_from_settings(tmp_path):
    s = Settings(database_url="sqlite://", media_dir=tmp_path, secret_key="k" * 40,
                 admin_username="root", admin_password="rootpass", _env_file=None)
    with TestClient(create_app(s)) as c:
        r = c.post("/api/auth/login", json={"username": "root", "password": "rootpass"})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin"
        # since an account exists, the next registration is a plain viewer
        r = c.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
        assert r.json()["user"]["role"] == "viewer"


def test_site_info_is_public(client):
    r = client.get("/api/site")
    assert r.status_code == 200
    assert r.json()["hero"].startswith("/media/")
