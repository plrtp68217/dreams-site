from datetime import datetime, timedelta, timezone

from app.db import Database
from app.html_utils import ensure_anchor_ids, has_anchor, html_to_text, sanitize_html, snippet
from app.models import Section, Task
from app.security import create_token, decode_token, hash_password, verify_password
from app.seed import load_seed, seed_scenario

KEY = "k" * 40


def test_seed_is_idempotent():
    db_ = Database("sqlite://")
    db_.create_all()
    with db_.SessionLocal() as db:
        data = load_seed()
        assert seed_scenario(db, data) is True
        assert seed_scenario(db, data) is False
        assert db.query(Section).count() == len(data["sections"])
        assert db.query(Task).count() == 0, "the board starts empty"
        ff = db.query(Section).filter_by(slug="ff-locs").one()
        assert "::: карточка Касса" in ff.source and 'data-id="loc-ff-05"' in ff.content


def test_seed_data_references_are_consistent():
    data = load_seed()
    slugs = {s["slug"] for s in data["sections"]}
    assert all(s["parent"] in slugs for s in data["sections"] if s["parent"])
    assert "tasks" not in data
    for s in data["sections"]:
        assert "data:image" not in s["content"]
        assert "data-task" not in s["content"], "former task cards are part of the text"
        assert "proposal" not in s["content"] and "редложени" not in s["content"], s["slug"]
        assert 'class="lid"' not in s["content"]


def test_sanitize_keeps_scenario_markup():
    html = ('<div class="line" data-id="X"><span class="who">Ева</span><q>Текст</q></div>'
            '<figure><img src="/media/a.png" alt="a" loading="lazy"></figure>'
            '<a href="#ff-v01">ссылка</a><pre class="mermaid">A --&gt; B</pre>')
    clean = sanitize_html(html)
    for fragment in ('class="line"', 'data-id="X"', "<q>Текст</q>", 'src="/media/a.png"', 'href="#ff-v01"',
                     'class="mermaid"'):
        assert fragment in clean


def test_ensure_anchor_ids():
    html = ('<h3>Глава</h3><div class="line"><q>a</q></div><div class="line" data-id="FF-1"><q>b</q></div>'
            '<div class="tbl-wrap"></div><p>текст</p><article id="card"></article><div class="note x">n</div>')
    out = ensure_anchor_ids(html)
    assert out.count('data-id="') == 4  # h3, the new line, the kept FF-1, the note
    assert '<div class="tbl-wrap">' in out and "<p>текст</p>" in out and '<article id="card">' in out
    assert has_anchor(out, "FF-1") and has_anchor(out, "card") and not has_anchor(out, "FF")
    assert ensure_anchor_ids(out) == out


def test_sanitize_drops_dangerous_urls():
    assert "javascript" not in sanitize_html('<a href="javascript:alert(1)">x</a>')
    assert "<iframe" not in sanitize_html('<iframe src="https://evil"></iframe>')


def test_text_helpers():
    assert html_to_text("<p>a&nbsp;<b>b</b></p>\n<p>c</p>") == "a b c"
    text = "x" * 200 + "клоун" + "y" * 200
    s = snippet(text, "КЛОУН", radius=10)
    assert s.startswith("…") and s.endswith("…") and "клоун" in s
    assert snippet("short", "missing") == "short"


def test_password_hashing():
    h = hash_password("secret")
    assert verify_password("secret", h)
    assert not verify_password("other", h)
    assert not verify_password("secret", "not-a-hash")


def test_tokens():
    token = create_token(42, KEY, 5)
    assert decode_token(token, KEY) == 42
    assert decode_token(token, "o" * 40) is None
    expired = create_token(42, KEY, -1)
    assert decode_token(expired, KEY) is None


def test_utc_roundtrip():
    db_ = Database("sqlite://")
    db_.create_all()
    moscow = timezone(timedelta(hours=3))
    with db_.SessionLocal() as db:
        s = Section(slug="t", title="t", updated_at=datetime(2026, 1, 1, 15, 0, tzinfo=moscow))
        db.add(s)
        db.commit()
        db.expire_all()
        loaded = db.get(Section, s.id)
        assert loaded.updated_at == datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
