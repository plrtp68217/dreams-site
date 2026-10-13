from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.types import TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .markup import render_scenario


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC, always returns aware UTC datetimes (SQLite drops tzinfo)."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class Role(str, enum.Enum):
    viewer = "viewer"
    editor = "editor"
    admin = "admin"

    @property
    def rank(self) -> int:
        return {"viewer": 0, "editor": 1, "admin": 2}[self.value]

    @property
    def in_team(self) -> bool:
        return self.rank >= Role.editor.rank


class SectionStatus(str, enum.Enum):
    done = "done"   # расписано полностью
    part = "part"   # есть концепт
    shot = "shot"   # восстановлено по скриншотам
    none = "none"   # нет в сценарии


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    review = "review"
    done = "done"


class TaskKind(str, enum.Enum):
    scenario = "scenario"  # сценарий и тексты
    design = "design"      # геймдизайн
    art = "art"
    code = "code"
    sound = "sound"
    other = "other"


class SectionGroup(str, enum.Enum):
    main = "main"
    levels = "levels"
    reference = "reference"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(128))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False), default=Role.viewer)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    group: Mapped[SectionGroup] = mapped_column(Enum(SectionGroup, native_enum=False), default=SectionGroup.main)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[SectionStatus] = mapped_column(Enum(SectionStatus, native_enum=False), default=SectionStatus.none)
    # what editors write (scenario Markdown, see markup.py) and the HTML rendered from it
    source: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    parent: Mapped[Section | None] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list[Section]] = relationship(
        back_populates="parent", order_by="Section.position", cascade="all, delete-orphan", passive_deletes=True
    )
    tasks: Mapped[list[Task]] = relationship(back_populates="section", order_by="Task.position")
    updated_by: Mapped[User | None] = relationship()

    @property
    def parent_slug(self) -> str | None:
        return self.parent.slug if self.parent else None

    def top(self) -> Section:
        node = self
        while node.parent is not None:
            node = node.parent
        return node


class Task(Base):
    """A unit of work on the board. Referred to by its number (#12); may point at a place in the scenario."""

    __tablename__ = "tasks"
    # never reuse the number of a deleted task
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[TaskKind] = mapped_column(Enum(TaskKind, native_enum=False), default=TaskKind.other)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus, native_enum=False), default=TaskStatus.todo)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # who checks the work (set by the reviewer, e.g. when sending the task back with a comment)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # description in Markdown
    content: Mapped[str] = mapped_column(Text, default="")
    # place in the scenario: a section and, optionally, an element inside it (id / data-id)
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"))
    anchor: Mapped[str | None] = mapped_column(String(80))
    anchor_label: Mapped[str] = mapped_column(String(300), default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    section: Mapped[Section | None] = relationship(back_populates="tasks")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewer_id])
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id])
    comments: Mapped[list[TaskComment]] = relationship(
        back_populates="task", order_by="TaskComment.id", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def comments_count(self) -> int:
        return len(self.comments)

    @property
    def section_slug(self) -> str | None:
        return self.section.slug if self.section else None

    @property
    def section_title(self) -> str | None:
        return self.section.title if self.section else None

    @property
    def content_html(self) -> str:
        return render_scenario(self.content) if self.content else ""

    @property
    def page(self) -> str | None:
        """Top-level section whose page shows the referenced place."""
        return self.section.top().slug if self.section else None


class TaskComment(Base):
    """A comment on a task; may record the status change it explains (e.g. «На проверке → В работе»)."""

    __tablename__ = "task_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Markdown
    text: Mapped[str] = mapped_column(Text)
    status_from: Mapped[TaskStatus | None] = mapped_column(Enum(TaskStatus, native_enum=False))
    status_to: Mapped[TaskStatus | None] = mapped_column(Enum(TaskStatus, native_enum=False))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    task: Mapped[Task] = relationship(back_populates="comments")
    author: Mapped[User | None] = relationship()

    @property
    def html(self) -> str:
        return render_scenario(self.text)


class Revision(Base):
    """Snapshot of a section/task *before* an edit, so any change can be rolled back."""

    __tablename__ = "revisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20), index=True)
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    author: Mapped[User | None] = relationship()


class Activity(Base):
    __tablename__ = "activity"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity_type: Mapped[str] = mapped_column(String(20))
    entity_key: Mapped[str] = mapped_column(String(80))
    entity_label: Mapped[str] = mapped_column(String(300), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)

    user: Mapped[User | None] = relationship()
