from .conftest import make_task


def test_seeded_tree(viewer):
    r = viewer.get("/api/sections")
    assert r.status_code == 200
    tree = r.json()
    slugs = [n["slug"] for n in tree]
    assert slugs[:3] == ["overview", "structure", "cast"]
    ff = next(n for n in tree if n["slug"] == "ff")
    assert ff["group"] == "levels"
    assert [c["slug"] for c in ff["children"]][:2] == ["ff-entry", "ff-space"]
    assert "content" not in ff


def test_read_section_with_tasks_and_children(viewer):
    r = viewer.get("/api/sections/ff")
    body = r.json()
    assert body["title"] == "Сон 1: Заброшенный фастфуд"
    visitors = next(c for c in body["children"] if c["slug"] == "ff-visitors")
    assert visitors["tasks"] == []
    # former task cards are part of the text now, with readable titles and their old anchors
    assert '<article class="quest kind-quest" id="ff-v01"' in visitors["content"]
    assert ">Мужчина без лица</h4>" in visitors["content"]


def test_read_missing_section(viewer):
    assert viewer.get("/api/sections/nope").status_code == 404


def test_viewer_cannot_write(viewer):
    assert viewer.patch("/api/sections/overview", json={"version": 1, "title": "X"}).status_code == 403
    assert viewer.put("/api/sections/overview/status", json={"status": "none"}).status_code == 403
    assert viewer.post("/api/sections", json={"slug": "new", "title": "New"}).status_code == 403
    assert viewer.delete("/api/sections/overview").status_code == 403


def test_editor_edits_content_with_revision_and_activity(editor):
    sec = editor.get("/api/sections/overview").json()
    r = editor.patch("/api/sections/overview", json={"version": sec["version"], "title": "Об игре (ред.)",
                                                     "content": "<p>Новый текст</p>"})
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == sec["version"] + 1
    assert body["content"] == "<p>Новый текст</p>"
    assert body["updated_by"]["username"] == "editor"

    revs = editor.get("/api/sections/overview/revisions").json()
    assert len(revs) == 1
    assert revs[0]["title"] == "Об игре"
    assert revs[0]["content"] == sec["content"]

    feed = editor.get("/api/activity", params={"entity_key": "overview"}).json()["items"]
    assert feed[0]["action"] == "section.edit"
    assert set(feed[0]["details"]["fields"]) == {"title", "content"}


def test_edit_sanitizes_html(editor):
    r = editor.patch("/api/sections/overview", json={
        "version": 1, "content": '<p onclick="steal()">ok</p><script>alert(1)</script><img src="x" onerror="x()">'})
    content = r.json()["content"]
    assert "script" not in content and "onclick" not in content and "onerror" not in content
    assert "<p>ok</p>" in content


def test_stale_version_conflicts(editor, admin):
    editor.patch("/api/sections/cast", json={"version": 1, "content": "<p>first</p>"})
    r = admin.patch("/api/sections/cast", json={"version": 1, "content": "<p>second</p>"})
    assert r.status_code == 409
    assert r.json()["detail"]["current_version"] == 2


def test_noop_edit_does_not_bump_version(editor):
    sec = editor.get("/api/sections/cast").json()
    r = editor.patch("/api/sections/cast", json={"version": sec["version"], "content": sec["content"]})
    assert r.json()["version"] == sec["version"]
    assert editor.get("/api/sections/cast/revisions").json() == []


def test_status_change(editor):
    r = editor.put("/api/sections/academy/status", json={"status": "done"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    assert r.json()["version"] == 1  # status is metadata, it must not invalidate open editors
    assert editor.put("/api/sections/academy/status", json={"status": "weird"}).status_code == 422
    entry = editor.get("/api/activity", params={"entity_key": "academy"}).json()["items"][0]
    assert entry["action"] == "section.status"
    assert entry["details"] == {"from": "part", "to": "done"}


def test_restore_revision(editor):
    original = editor.get("/api/sections/circus").json()
    editor.patch("/api/sections/circus", json={"version": 1, "content": "<p>v2</p>"})
    rev_id = editor.get("/api/sections/circus/revisions").json()[0]["id"]
    r = editor.post(f"/api/sections/circus/revisions/{rev_id}/restore")
    assert r.status_code == 200
    assert r.json()["content"] == original["content"]
    assert r.json()["version"] == 3
    assert len(editor.get("/api/sections/circus/revisions").json()) == 2
    assert editor.post("/api/sections/circus/revisions/9999/restore").status_code == 404


def test_create_child_section_and_delete(editor, admin):
    r = editor.post("/api/sections", json={"slug": "academy-plac", "title": "Плац", "parent_slug": "academy",
                                           "content": "<p>Строевая</p>"})
    assert r.status_code == 201
    assert r.json()["parent_slug"] == "academy"
    assert r.json()["group"] == "levels"  # inherited from parent
    assert editor.post("/api/sections", json={"slug": "academy-plac", "title": "dup"}).status_code == 409
    assert editor.post("/api/sections", json={"slug": "Bad Slug", "title": "x"}).status_code == 422
    assert editor.delete("/api/sections/academy-plac").status_code == 403
    assert admin.delete("/api/sections/academy-plac").status_code == 204
    assert admin.get("/api/sections/academy-plac").status_code == 404


def test_delete_section_keeps_tasks(admin):
    make_task(admin, section_slug="ff-side")
    assert admin.delete("/api/sections/ff-side").status_code == 204
    task = admin.get("/api/tasks/1").json()
    assert task["section_slug"] is None
