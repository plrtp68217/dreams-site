"""In-place upgrades of existing databases (the app has no Alembic; create_all only adds missing tables)."""
import logging
import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .db import Base
from .html_utils import ensure_anchor_ids
from .scenario_cleanup import convert

log = logging.getLogger(__name__)


def _backup_sqlite(engine: Engine) -> Path | None:
    path = engine.url.database
    if engine.url.get_backend_name() != "sqlite" or not path or path == ":memory:":
        return None
    src = Path(path)
    dst = src.with_name(f"{src.stem}.before-tasks-v2-{datetime.now():%Y%m%d-%H%M%S}{src.suffix}")
    shutil.copy2(src, dst)
    return dst


def upgrade_tasks_v2(engine: Engine) -> bool:
    """Old schema stored scenario cards as coded tasks (FF-V01…). Fold them back into the scenario text,
    strip proposals and code labels, and recreate an empty task board. Returns True if it ran."""
    columns = {c["name"] for c in inspect(engine).get_columns("tasks")}
    if "code" not in columns:
        return False
    backup = _backup_sqlite(engine)
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
