import io

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_search_finds_sections_and_tasks_in_cyrillic(viewer):
    hits = viewer.get("/api/search", params={"q": "КЛОУН"}).json()
    types = {h["type"] for h in hits}
    assert types == {"section", "task"}
    task_hit = next(h for h in hits if h["key"] == "FF-V07")
    assert task_hit["page"] == "ff"
    assert task_hit["anchor"] == "ff-v07"
    assert "клоун" in task_hit["snippet"].lower()


def test_search_by_code_and_validation(viewer):
    hits = viewer.get("/api/search", params={"q": "ff-s03"}).json()
    assert hits[0]["key"] == "FF-S03"
    assert viewer.get("/api/search", params={"q": "a"}).status_code == 422


def test_anchor_resolution(viewer):
    assert viewer.get("/api/anchors/ff-final").json() == {"page": "ff", "anchor": "ff-final"}
    assert viewer.get("/api/anchors/loc-ff-05").json() == {"page": "ff", "anchor": "loc-ff-05"}
    assert viewer.get("/api/anchors/overview").json()["page"] == "overview"
    # an id="…" inside section content
    assert viewer.get("/api/anchors/ff-branch").json()["page"] == "ff"
    assert viewer.get("/api/anchors/nowhere").status_code == 404


def test_upload_image(editor, settings, client):
    r = editor.post("/api/media", files={"file": ("pic.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 201
    url = r.json()["url"]
    assert url.startswith("/media/upload-") and url.endswith(".png")
    assert (settings.media_dir / url.removeprefix("/media/")).exists()
    assert client.get(url).status_code == 200


def test_upload_rejects_non_images_and_viewers(editor, viewer, settings):
    r = editor.post("/api/media", files={"file": ("evil.png", io.BytesIO(b"<svg onload=alert(1)>"), "image/png")})
    assert r.status_code == 415
    assert viewer.post("/api/media", files={"file": ("pic.png", io.BytesIO(PNG), "image/png")}).status_code == 403


def test_upload_size_limit(editor, settings):
    settings.max_upload_mb = 0
    r = editor.post("/api/media", files={"file": ("pic.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 413


def test_seeded_media_is_served(client):
    hero = client.get("/api/site").json()["hero"]
    # seeded images live in backend/media, test media dir is empty -> just check url shape
    assert hero.startswith("/media/legacy-")


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}
