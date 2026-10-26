from .conftest import make_task


def test_seeded_tree(viewer):
    r = viewer.get("/api/sections")
    assert r.status_code == 200
    tree = r.json()
    slugs = [n["slug"] for n in tree]
    assert slugs[:3] == ["overview", "structure", "cast"]
    ff = next(n for n in tree if n["slug"] == "ff")
    assert ff["group"] == "levels"
    assert [c["slug"] for c in ff["children"]][:3] == ["ff-entry", "ff-visitors", "ff-final"]
    assert "content" not in ff


def test_read_section_with_tasks_and_children(viewer):
    r = viewer.get("/api/sections/ff")
    body = r.json()
    assert body["title"] == "Сон 1: Заброшенный фастфуд"
    visitors = next(c for c in body["children"] if c["slug"] == "ff-visitors")
    assert visitors["tasks"] == []
    # former task cards are part of the text now, with readable titles and their old anchors
    assert '<article class="quest" data-id="ff-v01"' in visitors["content"]
    assert ">Мужчина без лица</h4>" in visitors["content"]


def test_read_missing_section(viewer):
    assert viewer.get("/api/sections/nope").status_code == 404


def test_viewer_cannot_write(viewer):
    assert viewer.patch("/api/sections/overview", json={"version": 1, "title": "X"}).status_code == 403
    assert viewer.put("/api/sections/overview/status", json={"status": "none"}).status_code == 403
    assert viewer.post("/api/sections", json={"slug": "new", "title": "New"}).status_code == 403
    assert viewer.delete("/api/sections/overview").status_code == 403


def test_sections_are_written_in_markdown(viewer):
    sec = viewer.get("/api/sections/ff-final").json()
    assert "<div" not in sec["source"] and "data-id" not in sec["source"]
    assert "> **Ева (шёпотом):** Я… сама?" in sec["source"]
    assert '<div class="line" data-id="FF-WAKE-EVA"><span class="who">Ева (шёпотом)</span><q>Я… сама?</q></div>' \
        in sec["content"]


def test_editor_edits_content_with_revision_and_activity(editor):
    sec = editor.get("/api/sections/overview").json()
    r = editor.patch("/api/sections/overview", json={"version": sec["version"], "title": "Об игре (ред.)",
                                                     "source": "Новый **текст**"})
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == sec["version"] + 1
    assert body["source"] == "Новый **текст**"
    assert body["content"] == "<p>Новый <strong>текст</strong></p>\n"
    assert body["updated_by"]["username"] == "editor"

    revs = editor.get("/api/sections/overview/revisions").json()
    assert len(revs) == 1
    assert revs[0]["title"] == "Об игре"
    assert revs[0]["content"] == sec["source"]
    assert revs[0]["html"].startswith('<p class="lede"')

    feed = editor.get("/api/activity", params={"entity_key": "overview"}).json()["items"]
    assert feed[0]["action"] == "section.edit"
    assert set(feed[0]["details"]["fields"]) == {"title", "content"}


def test_edit_sanitizes_html(editor):
    r = editor.patch("/api/sections/overview", json={
        "version": 1, "source": '<p onclick="steal()">ok</p><script>alert(1)</script><img src="x" onerror="x()">'})
    content = r.json()["content"]
    assert "script" not in content and "onclick" not in content and "onerror" not in content
    assert "<p>ok</p>" in content


def test_stale_version_conflicts(editor, admin):
    editor.patch("/api/sections/cast", json={"version": 1, "source": "first"})
    r = admin.patch("/api/sections/cast", json={"version": 1, "source": "second"})
    assert r.status_code == 409
    assert r.json()["detail"]["current_version"] == 2


def test_noop_edit_does_not_bump_version(editor):
    sec = editor.get("/api/sections/cast").json()
    r = editor.patch("/api/sections/cast", json={"version": sec["version"], "source": sec["source"]})
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
    editor.patch("/api/sections/circus", json={"version": 1, "source": "v2"})
    rev_id = editor.get("/api/sections/circus/revisions").json()[0]["id"]
    r = editor.post(f"/api/sections/circus/revisions/{rev_id}/restore")
    assert r.status_code == 200
    assert r.json()["source"] == original["source"]
    assert r.json()["content"] == original["content"]
    assert r.json()["version"] == 3
    assert len(editor.get("/api/sections/circus/revisions").json()) == 2
    assert editor.post("/api/sections/circus/revisions/9999/restore").status_code == 404


def test_create_child_section_and_delete(editor, admin):
    r = editor.post("/api/sections", json={"slug": "academy-plac", "title": "Плац", "parent_slug": "academy",
                                           "source": "Строевая"})
    assert r.status_code == 201
    assert r.json()["content"] == "<p>Строевая</p>\n"
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


def test_anchors_survive_edits(editor):
    """Tasks point at hidden ids; editing the Markdown (which has no ids) must keep them."""
    sec = editor.get("/api/sections/ff-final").json()
    source = sec["source"].replace("> **Ева (шёпотом):** Я… сама?", "> **Ева (шёпотом):** Я… сама? Правда?")
    source = source.replace("> **Клоун:** Вот теперь заказ полный.\n", "")
    r = editor.patch("/api/sections/ff-final", json={"version": sec["version"], "source": source + "\n> **Ева:** Новая реплика"})
    content = r.json()["content"]
    assert '<div class="line" data-id="FF-WAKE-EVA">' in content, "slightly edited line keeps its id"
    assert "FF-END-HIGH-3" not in content, "deleted line's id is gone"
    assert 'data-id="ff-branch"' in content, "ids from the old HTML moved to headings are kept"
    new_line = content.split("Новая реплика")[0].rsplit("<div", 1)[1]
    assert 'data-id="p-' in new_line, "new places get fresh ids"


def test_render_preview(editor, viewer):
    r = editor.post("/api/render", json={"source": "> **Клоун:** Привет\n\n::: заметка Важно\nтекст\n:::"})
    assert r.status_code == 200
    html = r.json()["html"]
    assert '<div class="line" data-id="p-' in html and '<span class="who">Клоун</span><q>Привет</q>' in html
    assert '<div class="callout" data-id="p-' in html and '<b class="tag">Важно</b><p>текст</p>' in html
    assert viewer.post("/api/render", json={"source": "x"}).status_code == 403
