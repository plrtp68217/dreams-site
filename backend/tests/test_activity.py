from .conftest import make_task, register


def test_summary_lists_only_team_members(client, admin, editor, viewer):
    first, second = make_task(editor), make_task(editor)
    editor.put(f"/api/tasks/{first['id']}/status", json={"status": "done"})
    editor.put(f"/api/tasks/{second['id']}/status", json={"status": "in_progress"})
    editor.patch("/api/sections/overview", json={"version": 1, "source": "x"})
    viewer.get("/api/sections")  # reading is not activity

    summary = viewer.get("/api/activity/summary").json()
    names = [s["user"]["username"] for s in summary]
    assert set(names) == {"admin", "editor"}
    ed = next(s for s in summary if s["user"]["username"] == "editor")
    assert ed["status_changes"] == 2
    assert ed["edits"] == 3  # 2 tasks created + 1 section edit
    assert ed["by_action"]["task.status"] == 2
    assert ed["last_active"] is not None
    assert ed["last_active"].endswith(("Z", "+00:00"))
    # sorted by total activity, most active first
    assert names[0] == "editor"


def test_feed_filters_and_paging(admin, editor):
    for _ in range(3):
        task = make_task(admin)
        editor.put(f"/api/tasks/{task['id']}/status", json={"status": "done"})
    page = admin.get("/api/activity", params={"user_id": editor.user["id"], "limit": 2}).json()
    assert page["total"] == 4  # 3 status changes + registration
    assert [i["entity_key"] for i in page["items"]] == ["3", "2"]
    page2 = admin.get("/api/activity", params={"user_id": editor.user["id"], "limit": 2, "offset": 2}).json()
    assert [i["entity_key"] for i in page2["items"]] == ["1", "editor"]
    tasks_only = admin.get("/api/activity", params={"entity_type": "task"}).json()
    assert tasks_only["total"] == 6  # 3 created + 3 status changes


def test_feed_since_filter(admin, editor):
    make_task(editor)
    future = admin.get("/api/activity", params={"since": "2999-01-01T00:00:00Z"}).json()
    assert future["total"] == 0


def test_feed_requires_auth(client):
    assert client.get("/api/activity").status_code == 401
    assert client.get("/api/activity/summary").status_code == 401


def test_new_member_appears_with_zero_activity(client, admin):
    bob = register(client, "bob")
    admin.patch(f"/api/users/{bob.user['id']}", json={"role": "editor"})
    bob_summary = next(s for s in admin.get("/api/activity/summary").json() if s["user"]["username"] == "bob")
    assert bob_summary["status_changes"] == 0
    assert bob_summary["by_action"] == {"user.register": 1}


def test_summary_counts_actions_per_day_in_viewer_time_zone(editor, admin):
    make_task(editor)
    make_task(editor)
    utc = {s["user"]["username"]: s for s in admin.get("/api/activity/summary").json()}
    assert sum(utc["editor"]["days"].values()) == utc["editor"]["total"] == 3  # registration + 2 tasks
    (day,) = utc["editor"]["days"]
    # +14h moves "now" to the next calendar day only when it is late in UTC; check the shift is applied
    far_east = {s["user"]["username"]: s for s in admin.get("/api/activity/summary", params={"tz": 14 * 60}).json()}
    (east_day,) = far_east["editor"]["days"]
    assert east_day >= day
    assert admin.get("/api/activity/summary", params={"tz": 9999}).status_code == 422
