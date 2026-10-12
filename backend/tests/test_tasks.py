def test_list_and_filter(viewer):
    all_tasks = viewer.get("/api/tasks").json()
    assert len(all_tasks) == 46
    quests = viewer.get("/api/tasks", params={"kind": "quest"}).json()
    assert len(quests) == 13
    side = viewer.get("/api/tasks", params={"section": "ff-side"}).json()
    assert [t["code"] for t in side] == [f"FF-S0{i}" for i in range(1, 7)]
    assert viewer.get("/api/tasks", params={"status": "done"}).json() == []


def test_read_task_case_insensitive(viewer):
    r = viewer.get("/api/tasks/ff-v01")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == "FF-V01"
    assert body["title"] == "Мужчина без лица"
    assert body["section_slug"] == "ff-visitors"
    assert viewer.get("/api/tasks/NOPE").status_code == 404


def test_viewer_cannot_change_tasks(viewer):
    assert viewer.put("/api/tasks/FF-V01/status", json={"status": "done"}).status_code == 403
    assert viewer.patch("/api/tasks/FF-V01", json={"version": 1, "title": "x"}).status_code == 403
    assert viewer.put("/api/tasks/FF-V01/assignee", json={"assignee_id": None}).status_code == 403
    assert viewer.post("/api/tasks", json={"code": "X-1", "title": "x"}).status_code == 403


def test_status_flow_and_progress(editor):
    for status in ("in_progress", "review", "done"):
        r = editor.put("/api/tasks/FF-V02/status", json={"status": status})
        assert r.status_code == 200 and r.json()["status"] == status
    editor.put("/api/tasks/FF-V03/status", json={"status": "in_progress"})
    p = editor.get("/api/tasks/progress").json()
    assert p["total"] == 46
    assert p["done"] == 1
    assert p["by_status"] == {"todo": 44, "in_progress": 1, "review": 0, "done": 1}
    assert editor.put("/api/tasks/FF-V02/status", json={"status": "bogus"}).status_code == 422

    feed = editor.get("/api/activity", params={"entity_key": "FF-V02"}).json()
    assert feed["total"] == 3
    assert feed["items"][0]["details"] == {"from": "review", "to": "done"}


def test_same_status_is_not_logged(editor):
    editor.put("/api/tasks/FF-V01/status", json={"status": "todo"})
    assert editor.get("/api/activity", params={"entity_key": "FF-V01"}).json()["total"] == 0


def test_assignee_must_be_team_member(editor, viewer):
    assert editor.put("/api/tasks/FF-V01/assignee",
                      json={"assignee_id": viewer.user["id"]}).status_code == 422
    r = editor.put("/api/tasks/FF-V01/assignee", json={"assignee_id": editor.user["id"]})
    assert r.status_code == 200
    assert r.json()["assignee"]["username"] == "editor"
    assert editor.get("/api/tasks", params={"assignee_id": editor.user["id"]}).json()[0]["code"] == "FF-V01"
    r = editor.put("/api/tasks/FF-V01/assignee", json={"assignee_id": None})
    assert r.json()["assignee"] is None


def test_edit_task_with_versioning(editor, admin):
    task = editor.get("/api/tasks/FF-S01").json()
    r = editor.patch("/api/tasks/FF-S01", json={"version": task["version"], "title": "Столы",
                                               "content": "<p>Записка: «Ты уже была здесь»</p>"})
    assert r.status_code == 200
    assert r.json()["version"] == 2
    stale = admin.patch("/api/tasks/FF-S01", json={"version": 1, "title": "Другое"})
    assert stale.status_code == 409
    revs = editor.get("/api/tasks/FF-S01/revisions").json()
    assert revs[0]["title"] == "Зал: «Протрите столы»"
    restored = editor.post(f"/api/tasks/FF-S01/revisions/{revs[0]['id']}/restore").json()
    assert restored["title"] == "Зал: «Протрите столы»"


def test_move_task_between_sections(editor):
    r = editor.patch("/api/tasks/Q-01", json={"version": 1, "section_slug": "prologue"})
    assert r.json()["section_slug"] == "prologue"
    assert editor.patch("/api/tasks/Q-01", json={"version": 2, "section_slug": "missing"}).status_code == 422


def test_create_and_delete_task(editor, admin):
    r = editor.post("/api/tasks", json={"code": "AC-V01", "title": "Особист", "kind": "quest",
                                        "section_slug": "academy", "assignee_id": editor.user["id"],
                                        "content": "<p>Ключ в кабинете</p>"})
    assert r.status_code == 201
    assert r.json()["assignee"]["id"] == editor.user["id"]
    assert editor.post("/api/tasks", json={"code": "AC-V01", "title": "dup"}).status_code == 409
    assert editor.post("/api/tasks", json={"code": "lower", "title": "x"}).status_code == 422
    section = editor.get("/api/sections/academy").json()
    assert [t["code"] for t in section["tasks"]] == ["AC-V01"]
    assert editor.delete("/api/tasks/AC-V01").status_code == 403
    assert admin.delete("/api/tasks/AC-V01").status_code == 204
    assert admin.get("/api/tasks/AC-V01").status_code == 404
