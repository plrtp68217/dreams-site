from sqlalchemy import create_engine, inspect, text

from app.migrations import upgrade_user_avatar

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def upload(api, user_id, data=PNG, name="me.png"):
    return api.put(f"/api/users/{user_id}/avatar", files={"file": (name, data, "image/png")})


def test_set_replace_and_remove_own_avatar(viewer, settings):
    r = upload(viewer, viewer.user["id"])
    assert r.status_code == 200, r.text
    first = r.json()["avatar"]
    assert first.startswith("/media/avatar-") and first.endswith(".png")
    assert (settings.media_dir / first.removeprefix("/media/")).read_bytes() == PNG
    assert viewer.get("/api/auth/me").json()["avatar"] == first

    second = upload(viewer, viewer.user["id"]).json()["avatar"]
    assert second != first
    assert not (settings.media_dir / first.removeprefix("/media/")).exists(), "the old picture is removed"

    assert viewer.delete(f"/api/users/{viewer.user['id']}/avatar").json()["avatar"] is None
    assert not (settings.media_dir / second.removeprefix("/media/")).exists()


def test_admin_sets_anyones_avatar(admin, editor, viewer):
    assert upload(editor, viewer.user["id"]).status_code == 403
    assert editor.delete(f"/api/users/{viewer.user['id']}/avatar").status_code == 403
    avatar = upload(admin, editor.user["id"]).json()["avatar"]
    assert upload(admin, 999).status_code == 404
    # the picture travels with the user everywhere a user is shown
    listed = {u["username"]: u["avatar"] for u in admin.get("/api/users").json()}
    assert listed["editor"] == avatar
    task = editor.post("/api/tasks", json={"title": "x", "assignee_id": editor.user["id"]}).json()
    assert task["assignee"]["avatar"] == avatar


def test_avatar_validation(editor):
    uid = editor.user["id"]
    assert upload(editor, uid, b"not an image", "x.txt").status_code == 415
    assert upload(editor, uid, PNG + b"\x00" * (2 * 1024 * 1024)).status_code == 413
    assert editor.get("/api/auth/me").json()["avatar"] is None


def test_upgrade_adds_avatar_column():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(64))"))
    assert upgrade_user_avatar(engine) is True
    assert "avatar" in {c["name"] for c in inspect(engine).get_columns("users")}
    assert upgrade_user_avatar(engine) is False
