import json
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .html_utils import sanitize_html
from .models import Role, Section, SectionGroup, SectionStatus, Task, TaskKind, TaskStatus, User
from .security import hash_password

SEED_FILE = Path(__file__).parent / "seed_data" / "scenario.json"


def load_seed(path: Path = SEED_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def seed_scenario(db: Session, data: dict) -> bool:
    """Populate an empty database with the imported scenario. Returns True if anything was inserted."""
    if db.scalar(select(func.count(Section.id))):
        return False
    by_slug: dict[str, Section] = {}
    for item in data["sections"]:
        section = Section(
            slug=item["slug"],
            title=item["title"],
            group=SectionGroup(item["group"]),
            status=SectionStatus(item["status"]),
            position=item["position"],
            content=sanitize_html(item["content"]),
            parent=by_slug.get(item["parent"]) if item["parent"] else None,
        )
        db.add(section)
        by_slug[section.slug] = section
    for item in data["tasks"]:
        db.add(Task(
            code=item["code"],
            title=item["title"],
            kind=TaskKind(item["kind"]),
            status=TaskStatus(item.get("status", "todo")),
            section=by_slug.get(item["section"]),
            content=sanitize_html(item["content"]),
            position=item["position"],
        ))
    db.commit()
    return True


def ensure_admin(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(func.lower(User.username) == username.lower()))
    if user is None:
        user = User(username=username, display_name=username, password_hash=hash_password(password), role=Role.admin)
        db.add(user)
        db.commit()
    return user
