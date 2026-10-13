from .conftest import make_task


def first_line(api, slug="ff-visitors") -> str:
    """data-id of the first dialogue line in a section."""
    content = api.get(f"/api/sections/{slug}").json()["content"]
    start = content.index('class="line"')
    return content[start:].split('data-id="', 1)[1].split('"', 1)[0]


def test_board_starts_empty(viewer):
    assert viewer.get("/api/tasks").json() == []
    assert viewer.get("/api/tasks/progress").json() == {
        "total": 0, "done": 0, "by_status": {"todo": 0, "in_progress": 0, "review": 0, "done": 0}}


def test_create_task_with_description_assignee_and_place(editor):
    anchor = first_line(editor)
    task = make_task(editor, title="Спрайт мужчины без лица", kind="art", content="  Размыть лицо, 4 ракурса.  ",
                     assignee_id=editor.user["id"], section_slug="ff-visitors", anchor=anchor,
                     anchor_label="Мужчина без лица: «Мне, пожалуйста, комбо…»")
    assert task["id"] == 1
    assert task["content"] == "Размыть лицо, 4 ракурса."
    assert task["assignee"]["username"] == "editor"
    assert task["created_by"]["username"] == "editor"
    assert (task["section_slug"], task["page"]) == ("ff-visitors", "ff")
    assert task["section_title"] == editor.get("/api/sections/ff-visitors").json()["title"]
    assert task["anchor"] == anchor and task["anchor_label"].startswith("Мужчина без лица")

    section = editor.get("/api/sections/ff-visitors").json()
    assert [(t["id"], t["anchor"]) for t in section["tasks"]] == [(1, anchor)]
    feed = editor.get("/api/activity", params={"entity_type": "task"}).json()["items"]
    assert (feed[0]["action"], feed[0]["entity_key"], feed[0]["details"]) == ("task.create", "1", {"to": "Editor"})


def test_task_numbers_are_sequential_and_never_reused(editor, admin):
    assert [make_task(editor, title=f"t{i}")["id"] for i in range(3)] == [1, 2, 3]
    assert admin.delete("/api/tasks/3").status_code == 204
    assert make_task(editor)["id"] == 4


def test_place_is_validated(editor):
    assert editor.post("/api/tasks", json={"title": "x", "section_slug": "missing"}).status_code == 422
    r = editor.post("/api/tasks", json={"title": "x", "section_slug": "ff-visitors", "anchor": "nope"})
    assert r.status_code == 422
    assert editor.post("/api/tasks", json={"title": "x", "anchor": "bad anchor!"}).status_code == 422
    # an anchor without a section is meaningless and dropped
    task = make_task(editor, anchor="ff-v01", anchor_label="x")
    assert (task["section_slug"], task["anchor"], task["anchor_label"]) == (None, None, "")
    # former card ids keep working as places
    task = make_task(editor, section_slug="ff-visitors", anchor="ff-v01", anchor_label="Мужчина без лица")
    assert task["anchor"] == "ff-v01"


def test_list_and_filter(editor):
    make_task(editor, title="a", kind="art", section_slug="ff-locs")
    make_task(editor, title="b", kind="code", assignee_id=editor.user["id"])
    make_task(editor, title="c", kind="art", status="review")

    def titles(**params):
        return [t["title"] for t in editor.get("/api/tasks", params=params).json()]

    assert titles() == ["a", "b", "c"]
    assert titles(kind="art") == ["a", "c"]
    assert titles(section="ff-locs") == ["a"]
    assert titles(assignee_id=editor.user["id"]) == ["b"]
    assert titles(status="review") == ["c"]
    assert "content" not in editor.get("/api/tasks").json()[0]


def test_read_task(editor, viewer):
    make_task(editor)
    assert viewer.get("/api/tasks/1").json()["title"] == "Нарисовать кассу"
    assert viewer.get("/api/tasks/99").status_code == 404
    assert viewer.get("/api/tasks/FF-V01").status_code == 422


def test_viewer_cannot_change_tasks(editor, viewer):
    make_task(editor)
    assert viewer.put("/api/tasks/1/status", json={"status": "done"}).status_code == 403
    assert viewer.patch("/api/tasks/1", json={"version": 1, "title": "x"}).status_code == 403
    assert viewer.put("/api/tasks/1/assignee", json={"assignee_id": None}).status_code == 403
    assert viewer.post("/api/tasks", json={"title": "x"}).status_code == 403


def test_status_flow_and_progress(editor):
    make_task(editor)
    make_task(editor)
    for status in ("in_progress", "review", "done"):
        r = editor.put("/api/tasks/1/status", json={"status": status})
        assert r.status_code == 200 and r.json()["status"] == status
    editor.put("/api/tasks/2/status", json={"status": "in_progress"})
    p = editor.get("/api/tasks/progress").json()
    assert p == {"total": 2, "done": 1, "by_status": {"todo": 0, "in_progress": 1, "review": 0, "done": 1}}
    assert editor.put("/api/tasks/1/status", json={"status": "bogus"}).status_code == 422

    feed = editor.get("/api/activity", params={"entity_type": "task", "entity_key": "1"}).json()
    assert feed["total"] == 4  # created + 3 status changes
    assert feed["items"][0]["details"] == {"from": "review", "to": "done"}


def test_same_status_is_not_logged(editor):
    make_task(editor)
    editor.put("/api/tasks/1/status", json={"status": "todo"})
    assert editor.get("/api/activity", params={"entity_key": "1"}).json()["total"] == 1


def test_assignee_must_be_team_member(editor, viewer):
    make_task(editor)
    assert editor.put("/api/tasks/1/assignee", json={"assignee_id": viewer.user["id"]}).status_code == 422
    assert editor.post("/api/tasks", json={"title": "x", "assignee_id": viewer.user["id"]}).status_code == 422
    r = editor.put("/api/tasks/1/assignee", json={"assignee_id": editor.user["id"]})
    assert r.status_code == 200
    assert r.json()["assignee"]["username"] == "editor"
    assert editor.get("/api/tasks", params={"assignee_id": editor.user["id"]}).json()[0]["id"] == 1
    r = editor.put("/api/tasks/1/assignee", json={"assignee_id": None})
    assert r.json()["assignee"] is None


def test_edit_task_with_versioning(editor, admin):
    make_task(editor, content="Старое описание")
    r = editor.patch("/api/tasks/1", json={"version": 1, "title": "Касса и табло", "content": "Новое описание",
                                           "kind": "art"})
    assert r.status_code == 200
    assert (r.json()["version"], r.json()["kind"]) == (2, "art")
    stale = admin.patch("/api/tasks/1", json={"version": 1, "title": "Другое"})
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_version"] == 2
    revs = editor.get("/api/tasks/1/revisions").json()
    assert (revs[0]["title"], revs[0]["content"]) == ("Нарисовать кассу", "Старое описание")
    restored = editor.post(f"/api/tasks/1/revisions/{revs[0]['id']}/restore").json()
    assert restored["title"] == "Нарисовать кассу"
    assert editor.post("/api/tasks/1/revisions/999/restore").status_code == 404


def test_change_and_clear_place(editor):
    make_task(editor, section_slug="ff-locs")
    anchor = first_line(editor)
    r = editor.patch("/api/tasks/1", json={"version": 1, "section_slug": "ff-visitors", "anchor": anchor,
                                           "anchor_label": "Реплика"})
    assert (r.json()["section_slug"], r.json()["anchor"], r.json()["version"]) == ("ff-visitors", anchor, 2)
    # a place that is not sent is left alone
    r = editor.patch("/api/tasks/1", json={"version": 2, "title": "Другое"})
    assert r.json()["anchor"] == anchor
    r = editor.patch("/api/tasks/1", json={"version": 3, "section_slug": None})
    assert (r.json()["section_slug"], r.json()["anchor"], r.json()["anchor_label"]) == (None, None, "")
    assert editor.patch("/api/tasks/1", json={"version": 4, "section_slug": "missing"}).status_code == 422
    feed = editor.get("/api/activity", params={"entity_key": "1", "limit": 1}).json()["items"]
    assert feed[0]["details"] == {"fields": ["place"]}


def test_delete_task_is_admin_only(editor, admin):
    make_task(editor)
    assert editor.delete("/api/tasks/1").status_code == 403
    assert admin.delete("/api/tasks/1").status_code == 204
    assert admin.get("/api/tasks/1").status_code == 404
