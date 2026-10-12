from datetime import datetime, timedelta, timezone

from app.db import Database
from app.html_utils import html_to_text, sanitize_html, snippet
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
        assert db.query(Task).count() == len(data["tasks"])


def test_seed_data_references_are_consistent():
    data = load_seed()
    slugs = {s["slug"] for s in data["sections"]}
    codes = {t["code"] for t in data["tasks"]}
    assert all(s["parent"] in slugs for s in data["sections"] if s["parent"])
    assert all(t["section"] in slugs for t in data["tasks"])
    placeholders = set()
    for s in data["sections"]:
        placeholders |= {c for c in codes if f'data-task="{c}"' in s["content"]}
    assert placeholders == codes, "every task is embedded in a section"
    assert all("data:image" not in s["content"] for s in data["sections"])


def test_sanitize_keeps_scenario_markup():
    html = ('<div class="line" data-id="X"><span class="who">Ева</span><q>Текст</q></div>'
            '<figure><img src="/media/a.png" alt="a" loading="lazy"></figure>'
            '<a href="#ff-v01">ссылка</a><pre class="mermaid">A --&gt; B</pre>')
    clean = sanitize_html(html)
    for fragment in ('class="line"', 'data-id="X"', "<q>Текст</q>", 'src="/media/a.png"', 'href="#ff-v01"',
                     'class="mermaid"'):
        assert fragment in clean


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
