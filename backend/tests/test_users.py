from .conftest import register


def test_any_user_can_list_users(viewer):
    r = viewer.get("/api/users")
    assert r.status_code == 200
    assert {u["username"] for u in r.json()} == {"admin", "viewer"}


def test_team_only_filter(editor, viewer):
    r = viewer.get("/api/users", params={"team_only": True})
    assert {u["username"] for u in r.json()} == {"admin", "editor"}


def test_admin_changes_role_and_it_is_logged(admin, viewer):
    r = admin.patch(f"/api/users/{viewer.user['id']}", json={"role": "editor"})
    assert r.status_code == 200
    assert r.json()["role"] == "editor"
    feed = admin.get("/api/activity", params={"entity_type": "user"}).json()["items"]
    role_change = next(i for i in feed if i["action"] == "user.role")
    assert role_change["details"] == {"from": "viewer", "to": "editor"}
    assert role_change["user"]["username"] == "admin"


def test_non_admins_cannot_manage_users(editor, viewer):
    for api in (editor, viewer):
        assert api.patch(f"/api/users/{viewer.user['id']}", json={"role": "admin"}).status_code == 403
        assert api.post("/api/users", json={"username": "x1x", "password": "secret123"}).status_code == 403
        assert api.post(f"/api/users/{viewer.user['id']}/password", json={"password": "newpass1"}).status_code == 403


def test_cannot_remove_last_admin(admin):
    me = admin.user["id"]
    assert admin.patch(f"/api/users/{me}", json={"role": "editor"}).status_code == 400
    assert admin.patch(f"/api/users/{me}", json={"is_active": False}).status_code == 400


def test_can_demote_admin_when_another_exists(client, admin):
    other = register(client, "second")
    admin.patch(f"/api/users/{other.user['id']}", json={"role": "admin"})
    r = admin.patch(f"/api/users/{admin.user['id']}", json={"role": "editor"})
    assert r.status_code == 200


def test_admin_creates_user_with_role(client, admin):
    r = admin.post("/api/users", json={"username": "artist", "password": "secret123", "role": "editor",
                                       "display_name": "Художник"})
    assert r.status_code == 201
    assert r.json()["role"] == "editor"
    assert admin.post("/api/users", json={"username": "artist", "password": "secret123"}).status_code == 409
    login = client.post("/api/auth/login", json={"username": "artist", "password": "secret123"})
    assert login.json()["user"]["display_name"] == "Художник"


def test_admin_resets_password(client, admin, viewer):
    assert admin.post(f"/api/users/{viewer.user['id']}/password", json={"password": "brandnew1"}).status_code == 204
    assert client.post("/api/auth/login", json={"username": "viewer", "password": "brandnew1"}).status_code == 200


def test_update_unknown_user(admin):
    assert admin.patch("/api/users/999", json={"role": "editor"}).status_code == 404


def test_rename_user(admin, viewer):
    r = admin.patch(f"/api/users/{viewer.user['id']}", json={"display_name": "  Зритель  "})
    assert r.json()["display_name"] == "Зритель"
