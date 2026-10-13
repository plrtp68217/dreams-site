from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_admin, require_team
from ..html_utils import ensure_anchor_ids, sanitize_html
from ..models import Revision, Section, SectionStatus, User
from ..schemas import RevisionOut, SectionCreate, SectionNode, SectionOut, SectionUpdate, StatusIn
from ..services import check_version, log_activity, revisions_for, snapshot, touch

router = APIRouter(prefix="/api/sections", tags=["sections"])


def get_section(db: Session, slug: str) -> Section:
    section = db.scalar(select(Section).where(Section.slug == slug))
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Раздел не найден")
    return section


def _node(section: Section) -> SectionNode:
    return SectionNode(
        id=section.id, slug=section.slug, title=section.title, group=section.group, status=section.status,
        position=section.position, parent_slug=section.parent_slug,
        children=[_node(c) for c in section.children],
    )


@router.get("", response_model=list[SectionNode])
def tree(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roots = db.scalars(select(Section).where(Section.parent_id.is_(None)).order_by(Section.position))
    return [_node(s) for s in roots]


@router.get("/{slug}", response_model=SectionOut)
def read(slug: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_section(db, slug)


@router.post("", response_model=SectionOut, status_code=status.HTTP_201_CREATED)
def create(data: SectionCreate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    if db.scalar(select(Section).where(Section.slug == data.slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Раздел с таким адресом уже есть")
    parent = get_section(db, data.parent_slug) if data.parent_slug else None
    position = data.position
    if position is None:
        siblings = select(func.max(Section.position)).where(
            Section.parent_id == parent.id if parent else Section.parent_id.is_(None)
        )
        position = (db.scalar(siblings) or 0) + 1
    section = Section(
        slug=data.slug, title=data.title, group=parent.group if parent else data.group, status=data.status,
        parent=parent, position=position, content=ensure_anchor_ids(sanitize_html(data.content)), updated_by_id=user.id,
    )
    db.add(section)
    db.flush()
    log_activity(db, user, "section.create", "section", section.slug, section.title)
    db.commit()
    return section


@router.patch("/{slug}", response_model=SectionOut)
def update(slug: str, data: SectionUpdate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    section = get_section(db, slug)
    check_version(section, data.version)
    changed: list[str] = []
    content = sanitize_html(data.content) if data.content is not None else None
    content_changed = content is not None and content != section.content
    title_changed = data.title is not None and data.title != section.title
    if content_changed or title_changed:
        snapshot(db, section, "section")
    if title_changed:
        changed.append("title")
        section.title = data.title
    if content_changed:
        changed.append("content")
        section.content = ensure_anchor_ids(content)
    if data.group is not None and data.group != section.group:
        changed.append("group")
        section.group = data.group
    if data.position is not None and data.position != section.position:
        changed.append("position")
        section.position = data.position
    if changed:
        touch(section, user)
        log_activity(db, user, "section.edit", "section", section.slug, section.title, fields=changed)
        db.commit()
    return section


@router.put("/{slug}/status", response_model=SectionOut)
def set_status(slug: str, data: StatusIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    section = get_section(db, slug)
    try:
        new = SectionStatus(data.status)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Неизвестный статус раздела")
    if new != section.status:
        log_activity(db, user, "section.status", "section", section.slug, section.title,
                     **{"from": section.status.value, "to": new.value})
        section.status = new
        touch(section, user, bump_version=False)
        db.commit()
    return section


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete(slug: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    section = get_section(db, slug)
    log_activity(db, user, "section.delete", "section", section.slug, section.title)
    db.delete(section)
    db.commit()


@router.get("/{slug}/revisions", response_model=list[RevisionOut])
def revisions(slug: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return revisions_for(db, "section", get_section(db, slug).id)


@router.post("/{slug}/revisions/{revision_id}/restore", response_model=SectionOut)
def restore(slug: str, revision_id: int, user: User = Depends(require_team), db: Session = Depends(get_db)):
    section = get_section(db, slug)
    rev = db.get(Revision, revision_id)
    if rev is None or rev.entity_type != "section" or rev.entity_id != section.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Версия не найдена")
    snapshot(db, section, "section")
    section.title, section.content = rev.title, rev.content
    touch(section, user)
    log_activity(db, user, "section.restore", "section", section.slug, section.title, version=rev.version)
    db.commit()
    return section
