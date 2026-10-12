from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_admin, require_team
from ..html_utils import sanitize_html
from ..models import Revision, Section, Task, TaskKind, TaskStatus, User
from ..schemas import AssigneeIn, Progress, RevisionOut, StatusIn, TaskBrief, TaskCreate, TaskOut, TaskUpdate
from ..services import check_version, log_activity, revisions_for, snapshot, touch

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def get_task(db: Session, code: str) -> Task:
    task = db.scalar(select(Task).where(Task.code == code.upper()))
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задача не найдена")
    return task


def _section(db: Session, slug: str | None) -> Section | None:
    if not slug:
        return None
    section = db.scalar(select(Section).where(Section.slug == slug))
    if section is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Раздел не найден")
    return section


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


@router.get("/{code}", response_model=TaskOut)
def read(code: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_task(db, code)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create(data: TaskCreate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    if db.scalar(select(Task).where(Task.code == data.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Задача с таким кодом уже есть")
    task = Task(
        code=data.code, title=data.title, kind=data.kind, status=data.status,
        section=_section(db, data.section_slug), assignee=_assignee(db, data.assignee_id),
        content=sanitize_html(data.content), position=(db.scalar(select(func.max(Task.position))) or 0) + 1,
        updated_by_id=user.id,
    )
    db.add(task)
    db.flush()
    log_activity(db, user, "task.create", "task", task.code, task.title)
    db.commit()
    return task


@router.patch("/{code}", response_model=TaskOut)
def update(code: str, data: TaskUpdate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, code)
    check_version(task, data.version)
    changed: list[str] = []
    content_changed = data.content is not None and sanitize_html(data.content) != task.content
    title_changed = data.title is not None and data.title != task.title
    if content_changed or title_changed:
        snapshot(db, task, "task")
    if title_changed:
        changed.append("title")
        task.title = data.title
    if content_changed:
        changed.append("content")
        task.content = sanitize_html(data.content)
    if data.kind is not None and data.kind != task.kind:
        changed.append("kind")
        task.kind = data.kind
    if "section_slug" in data.model_fields_set and data.section_slug != task.section_slug:
        changed.append("section")
        task.section = _section(db, data.section_slug)
    if changed:
        touch(task, user)
        log_activity(db, user, "task.edit", "task", task.code, task.title, fields=changed)
        db.commit()
    return task


@router.put("/{code}/status", response_model=TaskOut)
def set_status(code: str, data: StatusIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, code)
    try:
        new = TaskStatus(data.status)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Неизвестный статус задачи")
    if new != task.status:
        log_activity(db, user, "task.status", "task", task.code, task.title,
                     **{"from": task.status.value, "to": new.value})
        task.status = new
        touch(task, user, bump_version=False)
        db.commit()
    return task


@router.put("/{code}/assignee", response_model=TaskOut)
def set_assignee(code: str, data: AssigneeIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, code)
    assignee = _assignee(db, data.assignee_id)
    if task.assignee_id != data.assignee_id:
        log_activity(db, user, "task.assignee", "task", task.code, task.title,
                     **{"from": task.assignee.display_name if task.assignee else None,
                        "to": assignee.display_name if assignee else None})
        task.assignee = assignee
        touch(task, user, bump_version=False)
        db.commit()
    return task


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete(code: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    task = get_task(db, code)
    log_activity(db, user, "task.delete", "task", task.code, task.title)
    db.delete(task)
    db.commit()


@router.get("/{code}/revisions", response_model=list[RevisionOut])
def revisions(code: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return revisions_for(db, "task", get_task(db, code).id)


@router.post("/{code}/revisions/{revision_id}/restore", response_model=TaskOut)
def restore(code: str, revision_id: int, user: User = Depends(require_team), db: Session = Depends(get_db)):
    task = get_task(db, code)
    rev = db.get(Revision, revision_id)
    if rev is None or rev.entity_type != "task" or rev.entity_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Версия не найдена")
    snapshot(db, task, "task")
    task.title, task.content = rev.title, rev.content
    touch(task, user)
    log_activity(db, user, "task.restore", "task", task.code, task.title, version=rev.version)
    db.commit()
    return task
