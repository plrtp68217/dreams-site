"""In-place upgrades of existing databases (the app has no Alembic; create_all only adds missing tables)."""
import logging
import shutil
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .db import Base
from .html_to_markdown import html_to_markdown
from .html_utils import ensure_anchor_ids
from .scenario_cleanup import convert

log = logging.getLogger(__name__)


def _backup_sqlite(engine: Engine, label: str) -> Path | None:
    path = engine.url.database
    if engine.url.get_backend_name() != "sqlite" or not path or path == ":memory:":
        return None
    src = Path(path)
    dst = src.with_name(f"{src.stem}.before-{label}-{datetime.now():%Y%m%d-%H%M%S}{src.suffix}")
    shutil.copy2(src, dst)
    return dst


def upgrade_tasks_v2(engine: Engine) -> bool:
    """Old schema stored scenario cards as coded tasks (FF-V01…). Fold them back into the scenario text,
    strip proposals and code labels, and recreate an empty task board. Returns True if it ran."""
    columns = {c["name"] for c in inspect(engine).get_columns("tasks")}
    if "code" not in columns:
        return False
    backup = _backup_sqlite(engine, "tasks-v2")
    with engine.begin() as conn:
        tasks = [dict(r._mapping) for r in conn.execute(text("SELECT code, title, kind, content FROM tasks"))]
        rows = conn.execute(text("SELECT id, title, content, version, updated_at, updated_by_id FROM sections"))
        sections = [dict(r._mapping) for r in rows]
        originals = {s["id"]: s["content"] for s in sections}
        convert(sections, tasks)
        for s in sections:
            content = ensure_anchor_ids(s["content"])
            if content == originals[s["id"]]:
                continue
            # keep the pre-migration text in the history, like any other edit
            conn.execute(
                text("INSERT INTO revisions (entity_type, entity_id, version, title, content, author_id, created_at) "
                     "VALUES ('section', :id, :version, :title, :content, :author, :at)"),
                {"id": s["id"], "version": s["version"], "title": s["title"], "content": originals[s["id"]],
                 "author": s["updated_by_id"], "at": s["updated_at"]},
            )
            conn.execute(text("UPDATE sections SET content = :content, version = version + 1 WHERE id = :id"),
                         {"content": content, "id": s["id"]})
        conn.execute(text("DELETE FROM revisions WHERE entity_type = 'task'"))
        conn.execute(text("DROP TABLE tasks"))
    Base.metadata.tables["tasks"].create(engine)
    log.warning("Tasks migrated to v2: %d scenario cards folded into sections, board emptied (backup: %s)",
                len(tasks), backup)
    return True


_PLACE_TAGS = {"h3", "h4", "article"}


def promote_ids(html: str) -> str:
    """Ids on elements that are not places (e.g. <li id="ff-branch"> of a step list) move to their heading,
    so links to them survive the move to Markdown, which has no ids."""
    soup = BeautifulSoup(html, "html.parser")
    changed = False
    for el in soup.find_all(id=True):
        classes = set(el.get("class") or [])
        if el.name in _PLACE_TAGS or (el.name == "div" and classes & {"line", "note", "callout"}):
            continue
        heading = el.find(["h3", "h4"])
        if heading is not None:
            heading["data-id"] = el["id"]
            del el["id"]
            changed = True
    return str(soup) if changed else html


def upgrade_markdown(engine: Engine, render) -> bool:
    """Sections are now written in Markdown (sections.source); convert the stored HTML once.

    `render(source, previous_html)` turns Markdown into the stored HTML, carrying anchors over from the previous
    version. Section revisions are converted too, so restoring an old version gives Markdown back."""
    columns = {c["name"] for c in inspect(engine).get_columns("sections")}
    if "source" in columns:
        return False
    backup = _backup_sqlite(engine, "markdown")
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE sections ADD COLUMN source TEXT NOT NULL DEFAULT ''"))
        for row in conn.execute(text("SELECT id, content FROM sections")).all():
            source = html_to_markdown(row.content)
            conn.execute(text("UPDATE sections SET source = :source, content = :content WHERE id = :id"),
                         {"source": source, "content": render(source, promote_ids(row.content)), "id": row.id})
        for row in conn.execute(text("SELECT id, content FROM revisions WHERE entity_type = 'section'")).all():
            conn.execute(text("UPDATE revisions SET content = :content WHERE id = :id"),
                         {"content": html_to_markdown(row.content), "id": row.id})
    log.warning("Sections converted to Markdown (backup: %s)", backup)
    return True


def upgrade_task_reviewer(engine: Engine) -> bool:
    """Tasks got a reviewer (tasks.reviewer_id); comments are a new table, created by create_all."""
    columns = {c["name"] for c in inspect(engine).get_columns("tasks")}
    if "reviewer_id" in columns:
        return False
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE tasks ADD COLUMN reviewer_id INTEGER REFERENCES users (id) ON DELETE SET NULL"))
    return True
