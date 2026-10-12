from sqlalchemy import select

from app import cli
from app.config import Settings
from app.db import Database
from app.models import Role, Section, User


def run(monkeypatch, tmp_path, *argv):
    url = f"sqlite:///{(tmp_path / 'cli.db').as_posix()}"
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(database_url=url, _env_file=None))
    return cli.main(list(argv)), Database(url)


def test_create_admin_and_set_role(monkeypatch, tmp_path, capsys):
    code, database = run(monkeypatch, tmp_path, "create-admin", "boss", "secret123")
    assert code == 0
    code, _ = run(monkeypatch, tmp_path, "set-role", "BOSS", "editor")
    assert code == 0
    with database.SessionLocal() as db:
        assert db.scalar(select(User)).role == Role.editor
    database.engine.dispose()
    assert run(monkeypatch, tmp_path, "set-role", "ghost", "admin")[0] == 1


def test_reseed(monkeypatch, tmp_path):
    code, database = run(monkeypatch, tmp_path, "reseed")
    assert code == 0
    with database.SessionLocal() as db:
        assert db.scalar(select(Section).where(Section.slug == "ff")) is not None
    database.engine.dispose()


def test_usage(monkeypatch, tmp_path, capsys):
    assert cli.main([]) == 1
    assert run(monkeypatch, tmp_path, "unknown")[0] == 1
    assert "set-role" in capsys.readouterr().out
