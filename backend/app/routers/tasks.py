from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_admin, require_team
from ..html_utils import has_anchor
from ..models import Revision, Section, Task, TaskKind, TaskStatus, User
from ..schemas import AssigneeIn, Progress, RevisionOut, StatusIn, TaskBrief, TaskCreate, TaskOut, TaskUpdate
from ..services import check_version, log_activity, revisions_for, snapshot, touch

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def get_task(db: Session, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задача не найдена")
    return task


def _key(task: Task) -> str:
    return str(task.id)


def _section(db: Session, slug: str | None) -> Section | None:
    if not slug:
        return None
    section = db.scalar(select(Section).where(Section.slug == slug))
    if section is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Раздел не найден")
    return section


def _place(db: Session, slug: str | None, anchor: str | None, label: str | None) -> tuple[Section | None, str | None, str]:
    """Validate a reference to the scenario: a section and, optionally, an element inside it."""
    section = _section(db, slug)
    if section is None:
        return None, None, ""
    if anchor and not has_anchor(section.content, anchor):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Такого места в разделе нет — обновите страницу")
    return section, anchor or None, (label or "").strip() if anchor else ""


def _assignee(db: Session, user_id: int | None) -> User | None:
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active or not user.role.in_team:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Исполнителем может быть только участник команды")
    return user


@router.get("", response_model=list[TaskBrief])
def list_tasks(
    status_: TaskStatus | None = Query(default=None, alias="status"),
    kind: TaskKind | None = None,
    section: str | None = None,
    assignee_id: int | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Task).order_by(Task.position, Task.id)
    if status_ is not None:
        stmt = stmt.where(Task.status == status_)
    if kind is not None:
        stmt = stmt.where(Task.kind == kind)
    if section:
        stmt = stmt.join(Section).where(Section.slug == section)
    if assignee_id is not None:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    return list(db.scalars(stmt))


@router.get("/progress", response_model=Progress)
def progress(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = dict(db.execute(select(Task.status, func.count(Task.id)).group_by(Task.status)).all())
    by_status = {s: rows.get(s, 0) for s in TaskStatus}
    return Progress(total=sum(by_status.values()), by_status=by_status, done=by_status[TaskStatus.done])


@router.get("/{task_id}", response_model=TaskOut)
def read(task_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_task(db, task_id)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create(data: TaskCreate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    section, anchor, label = _place(db, data.section_slug, data.anchor, data.anchor_label)
    task = Task(
        title=data.title.strip(), kind=data.kind, status=data.status, content=data.content.strip(),
        section=section, anchor=anchor, anchor_label=label, assignee=_assignee(db, data.assignee_id),
        position=(db.scalar(select(func.max(Task.position))) or 0) + 1,
        created_by_id=user.id, updated_by_id=user.id,
    )
    db.add(task)
    db.flush()
    details = {"to": task.assignee.display_name} if task.assignee else {}
    log_activity(db, user, "task.create", "task", _key(task), task.title, **details)
    db.commit()
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update(task_id: int, data: TaskUpdate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, task_id)
    check_version(task, data.version)
    changed: list[str] = []
    content = data.content.strip() if data.content is not None else None
    content_changed = content is not None and content != task.content
    title_changed = data.title is not None and data.title.strip() != task.title
    if content_changed or title_changed:
        snapshot(db, task, "task")
    if title_changed:
        changed.append("title")
        task.title = data.title.strip()
    if content_changed:
        changed.append("content")
        task.content = content
    if data.kind is not None and data.kind != task.kind:
        changed.append("kind")
        task.kind = data.kind
    if "section_slug" in data.model_fields_set:
        section, anchor, label = _place(db, data.section_slug, data.anchor, data.anchor_label)
        if (section, anchor, label) != (task.section, task.anchor, task.anchor_label):
            changed.append("place")
            task.section, task.anchor, task.anchor_label = section, anchor, label
    if changed:
        touch(task, user)
        log_activity(db, user, "task.edit", "task", _key(task), task.title, fields=changed)
        db.commit()
    return task


@router.put("/{task_id}/status", response_model=TaskOut)
def set_status(task_id: int, data: StatusIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, task_id)
    try:
        new = TaskStatus(data.status)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Неизвестный статус задачи")
    if new != task.status:
        log_activity(db, user, "task.status", "task", _key(task), task.title,
                     **{"from": task.status.value, "to": new.value})
        task.status = new
        touch(task, user, bump_version=False)
        db.commit()
    return task


@router.put("/{task_id}/assignee", response_model=TaskOut)
def set_assignee(task_id: int, data: AssigneeIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, task_id)
    assignee = _assignee(db, data.assignee_id)
    if task.assignee_id != data.assignee_id:
        log_activity(db, user, "task.assignee", "task", _key(task), task.title,
                     **{"from": task.assignee.display_name if task.assignee else None,
                        "to": assignee.display_name if assignee else None})
        task.assignee = assignee
        touch(task, user, bump_version=False)
        db.commit()
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(task_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    task = get_task(db, task_id)
    log_activity(db, user, "task.delete", "task", _key(task), task.title)
    db.delete(task)
    db.commit()


@router.get("/{task_id}/revisions", response_model=list[RevisionOut])
def revisions(task_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return revisions_for(db, "task", get_task(db, task_id).id)


@router.post("/{task_id}/revisions/{revision_id}/restore", response_model=TaskOut)
def restore(task_id: int, revision_id: int, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, task_id)
    rev = db.get(Revision, revision_id)
    if rev is None or rev.entity_type != "task" or rev.entity_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Версия не найдена")
    snapshot(db, task, "task")
    task.title, task.content = rev.title, rev.content
    touch(task, user)
    log_activity(db, user, "task.restore", "task", _key(task), task.title, version=rev.version)
    db.commit()
    return task
