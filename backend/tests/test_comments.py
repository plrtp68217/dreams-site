from sqlalchemy import create_engine, inspect, text

from app.migrations import upgrade_task_reviewer

from .conftest import make_task


def test_comment_with_status_change_and_reviewer(editor, admin):
    task = make_task(editor, assignee_id=editor.user["id"])
    editor.put(f"/api/tasks/{task['id']}/status", json={"status": "review"})

    r = admin.post(f"/api/tasks/{task['id']}/comments", json={
        "text": "Лицо всё ещё **видно** — нужно размыть.", "status": "in_progress", "set_reviewer": True})
    assert r.status_code == 201
    body = r.json()
    comment, updated = body["comment"], body["task"]
    assert comment["author"]["username"] == "admin"
    assert (comment["status_from"], comment["status_to"]) == ("review", "in_progress")
    assert "<strong>видно</strong>" in comment["html"]
    assert updated["status"] == "in_progress"
    assert updated["reviewer"]["username"] == "admin"
    assert updated["comments_count"] == 1
    assert updated["version"] == 1, "comments do not invalidate open editors"

    listed = editor.get(f"/api/tasks/{task['id']}/comments").json()
    assert [c["id"] for c in listed] == [comment["id"]]
    assert editor.get("/api/tasks").json()[0]["reviewer"]["username"] == "admin"

    feed = admin.get("/api/activity", params={"entity_type": "task", "entity_key": str(task["id"])}).json()["items"]
    assert [i["action"] for i in feed[:3]] == ["task.reviewer", "task.status", "task.comment"]
    assert feed[1]["details"] == {"from": "review", "to": "in_progress", "comment": comment["id"]}
    assert feed[2]["details"]["text"].startswith("Лицо всё ещё")


def test_plain_comment_and_validation(editor, viewer):
    task = make_task(editor)
    r = editor.post(f"/api/tasks/{task['id']}/comments", json={"text": "Начал", "status": "todo"})
    assert r.json()["comment"]["status_to"] is None, "same status is not a change"
    assert r.json()["task"]["reviewer"] is None
    assert editor.post(f"/api/tasks/{task['id']}/comments", json={"text": "   "}).status_code == 422
    assert editor.post(f"/api/tasks/{task['id']}/comments", json={"text": ""}).status_code == 422
    assert viewer.post(f"/api/tasks/{task['id']}/comments", json={"text": "x"}).status_code == 403
    assert viewer.get(f"/api/tasks/{task['id']}/comments").status_code == 200
    assert editor.post("/api/tasks/999/comments", json={"text": "x"}).status_code == 404


def test_delete_comment_author_or_admin(client, editor, admin):
    from .conftest import register

    other = register(client, "other")
    admin.patch(f"/api/users/{other.user['id']}", json={"role": "editor"})
    task = make_task(editor)
    cid = editor.post(f"/api/tasks/{task['id']}/comments", json={"text": "мой"}).json()["comment"]["id"]
    assert other.delete(f"/api/tasks/{task['id']}/comments/{cid}").status_code == 403
    assert editor.delete(f"/api/tasks/999/comments/{cid}").status_code == 404
    assert editor.delete(f"/api/tasks/{task['id']}/comments/{cid}").status_code == 204
    cid = editor.post(f"/api/tasks/{task['id']}/comments", json={"text": "ещё"}).json()["comment"]["id"]
    assert admin.delete(f"/api/tasks/{task['id']}/comments/{cid}").status_code == 204
    assert editor.get(f"/api/tasks/{task['id']}/comments").json() == []
    # comments go away with their task
    editor.post(f"/api/tasks/{task['id']}/comments", json={"text": "третий"})
    assert admin.delete(f"/api/tasks/{task['id']}").status_code == 204


def test_set_reviewer(editor, viewer):
    task = make_task(editor)
    url = f"/api/tasks/{task['id']}/reviewer"
    assert editor.put(url, json={"reviewer_id": viewer.user["id"]}).status_code == 422
    assert viewer.put(url, json={"reviewer_id": None}).status_code == 403
    r = editor.put(url, json={"reviewer_id": editor.user["id"]})
    assert r.json()["reviewer"]["username"] == "editor"
    assert editor.put(url, json={"reviewer_id": editor.user["id"]}).status_code == 200  # no-op
    assert editor.put(url, json={"reviewer_id": None}).json()["reviewer"] is None
    actions = [i["action"] for i in editor.get("/api/activity", params={"entity_key": str(task["id"])}).json()["items"]]
    assert actions.count("task.reviewer") == 2


def test_upgrade_adds_reviewer_column():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title VARCHAR(300))"))
    assert upgrade_task_reviewer(engine) is True
    assert "reviewer_id" in {c["name"] for c in inspect(engine).get_columns("tasks")}
    assert upgrade_task_reviewer(engine) is False
