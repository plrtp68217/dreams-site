import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_url="sqlite://",
        media_dir=tmp_path / "media",
        secret_key="test-secret-key-that-is-long-enough-for-hs256",
        seed_on_startup=True,
        admin_username=None,
        admin_password=None,
        _env_file=None,
    )


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


class Api:
    """Small helper to act as a given user."""

    def __init__(self, client: TestClient, token: str, user: dict):
        self.client = client
        self.user = user
        self.headers = {"Authorization": f"Bearer {token}"}

    def __getattr__(self, method):
        def call(url, **kw):
            kw.setdefault("headers", self.headers)
            return getattr(self.client, method)(url, **kw)
        return call


def register(client: TestClient, username: str, password: str = "secret123") -> Api:
    r = client.post("/api/auth/register", json={"username": username, "password": password,
                                                "display_name": username.title()})
    assert r.status_code == 201, r.text
    body = r.json()
    return Api(client, body["access_token"], body["user"])


@pytest.fixture
def admin(client) -> Api:
    # the first registered account is promoted to admin automatically
    return register(client, "admin")


@pytest.fixture
def editor(client, admin) -> Api:
    api = register(client, "editor")
    r = admin.patch(f"/api/users/{api.user['id']}", json={"role": "editor"})
    assert r.status_code == 200
    api.user = r.json()
    return api


@pytest.fixture
def viewer(client, admin) -> Api:
    return register(client, "viewer")


def make_task(api: Api, **fields) -> dict:
    r = api.post("/api/tasks", json={"title": "Нарисовать кассу", **fields})
    assert r.status_code == 201, r.text
    return r.json()
