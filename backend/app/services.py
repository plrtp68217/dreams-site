"""Shared helpers for write operations: activity log, revisions, optimistic locking."""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Activity, Revision, Section, Task, User, utcnow


def log_activity(
    db: Session,
    user: User | None,
    action: str,
    entity_type: str,
    entity_key: str,
    entity_label: str = "",
    **details,
) -> Activity:
    entry = Activity(
        user_id=user.id if user else None,
        action=action,
        entity_type=entity_type,
        entity_key=entity_key,
        entity_label=entity_label,
        details=details,
    )
    db.add(entry)
    return entry


def check_version(entity: Section | Task, version: int) -> None:
    if entity.version != version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": "Запись уже изменил другой участник. Обновите страницу и повторите правку.",
                "current_version": entity.version,
            },
        )


def snapshot(db: Session, entity: Section | Task, entity_type: str) -> None:
    """Store the current state before it is overwritten."""
    db.add(
        Revision(
            entity_type=entity_type,
            entity_id=entity.id,
            version=entity.version,
            title=entity.title,
            # sections keep their Markdown source in the history; task descriptions are Markdown already
            content=entity.source if isinstance(entity, Section) else entity.content,
            author_id=entity.updated_by_id,
            created_at=entity.updated_at,
        )
    )


def touch(entity: Section | Task, user: User, bump_version: bool = True) -> None:
    if bump_version:
        entity.version += 1
    entity.updated_at = utcnow()
    entity.updated_by_id = user.id


def revisions_for(db: Session, entity_type: str, entity_id: int) -> list[Revision]:
    stmt = (
        select(Revision)
        .where(Revision.entity_type == entity_type, Revision.entity_id == entity_id)
        .order_by(Revision.version.desc())
    )
    return list(db.scalars(stmt))
