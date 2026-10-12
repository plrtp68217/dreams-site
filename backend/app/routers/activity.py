from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Activity, Role, User
from ..schemas import ActivityPage, MemberSummary, UserOut

router = APIRouter(prefix="/api/activity", tags=["activity"])

EDIT_ACTIONS = {"section.edit", "section.create", "section.restore", "task.edit", "task.create", "task.restore"}
STATUS_ACTIONS = {"section.status", "task.status"}


@router.get("", response_model=ActivityPage)
def feed(
    user_id: int | None = None,
    entity_type: str | None = None,
    entity_key: str | None = None,
    since: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Activity)
    if user_id is not None:
        stmt = stmt.where(Activity.user_id == user_id)
    if entity_type:
        stmt = stmt.where(Activity.entity_type == entity_type)
    if entity_key:
        stmt = stmt.where(Activity.entity_key == entity_key)
    if since is not None:
        stmt = stmt.where(Activity.created_at >= since)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(Activity.created_at.desc(), Activity.id.desc()).limit(limit).offset(offset))
    return ActivityPage(items=list(items), total=total)


@router.get("/summary", response_model=list[MemberSummary])
def summary(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Per-member activity for everyone in the team (editors and admins)."""
    members = list(db.scalars(
        select(User).where(User.role.in_([Role.editor, Role.admin])).order_by(User.display_name)
    ))
    rows = db.execute(
        select(Activity.user_id, Activity.action, func.count(Activity.id), func.max(Activity.created_at))
        .where(Activity.user_id.in_([m.id for m in members]))
        .group_by(Activity.user_id, Activity.action)
    ).all()
    stats: dict[int, dict] = {m.id: {"by_action": {}, "last": None} for m in members}
    for user_id, action, count, last in rows:
        s = stats[user_id]
        s["by_action"][action] = count
        s["last"] = last if s["last"] is None or (last and last > s["last"]) else s["last"]
    result = []
    for m in members:
        by_action = stats[m.id]["by_action"]
        result.append(MemberSummary(
            user=UserOut.model_validate(m),
            total=sum(by_action.values()),
            edits=sum(v for k, v in by_action.items() if k in EDIT_ACTIONS),
            status_changes=sum(v for k, v in by_action.items() if k in STATUS_ACTIONS),
            last_active=stats[m.id]["last"],
            by_action=by_action,
        ))
    result.sort(key=lambda s: s.total, reverse=True)
    return result
