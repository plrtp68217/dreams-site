"""One-time replacement of obsolete fast food content, preserving edit history."""
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .html_to_markdown import html_to_markdown
from .markup import render_scenario
from .migrations import _backup_sqlite, promote_ids
from .models import Revision, Section, SectionStatus, utcnow

UPDATE_KEY = "fastfood-notes-2026-11-03"
SHARED = {"cast", "items", "flags", "art-review", "open"}


def update_fastfood(db: Session, data: dict) -> bool:
    engine = db.get_bind()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS content_updates (name VARCHAR(100) PRIMARY KEY)"))
        if conn.execute(text("SELECT name FROM content_updates WHERE name = :name"), {"name": UPDATE_KEY}).first():
            return False
    rows = {s.slug: s for s in db.scalars(select(Section))}
    if "ff" not in rows:
        return False
    _backup_sqlite(engine, "fastfood-notes")
    for item in data["sections"]:
        slug = item["slug"]
        if not (slug == "ff" or slug.startswith("ff-") or slug in SHARED) or slug not in rows:
            continue
        section = rows[slug]
        html = promote_ids(item["content"])
        source = html_to_markdown(html)
        content = render_scenario(source, html)
        if (section.source, section.title, section.status.value) == (source, item["title"], item["status"]):
            continue
        db.add(Revision(entity_type="section", entity_id=section.id, version=section.version,
                        title=section.title, content=section.source, author_id=section.updated_by_id))
        section.source = source
        section.content = content
        section.title = item["title"]
        section.status = SectionStatus(item["status"])
        section.version += 1
        section.updated_at = utcnow()
    db.execute(text("INSERT INTO content_updates (name) VALUES (:name)"), {"name": UPDATE_KEY})
    db.commit()
    return True
