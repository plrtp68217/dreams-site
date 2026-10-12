from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import Role, SectionGroup, SectionStatus, TaskKind, TaskStatus

USERNAME_PATTERN = r"^[A-Za-z0-9_.\-]{3,64}$"
SLUG_PATTERN = r"^[a-z0-9][a-z0-9\-]{0,79}$"
CODE_PATTERN = r"^[A-Z0-9][A-Z0-9\-_]{0,39}$"


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth / users ----------

class RegisterIn(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


class UserOut(ORM):
    id: int
    username: str
    display_name: str
    role: Role
    is_active: bool
    created_at: datetime


class UserBrief(ORM):
    id: int
    username: str
    display_name: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=128)


# ---------- sections ----------

class SectionNode(ORM):
    id: int
    slug: str
    title: str
    group: SectionGroup
    status: SectionStatus
    position: int
    parent_slug: str | None = None
    children: list["SectionNode"] = []


class TaskOut(ORM):
    id: int
    code: str
    title: str
    kind: TaskKind
    status: TaskStatus
    section_slug: str | None
    assignee: UserBrief | None
    content: str
    position: int
    version: int
    updated_at: datetime
    updated_by: UserBrief | None


class TaskBrief(ORM):
    id: int
    code: str
    title: str
    kind: TaskKind
    status: TaskStatus
    section_slug: str | None
    assignee: UserBrief | None
    position: int
    updated_at: datetime


class SectionOut(ORM):
    id: int
    slug: str
    title: str
    group: SectionGroup
    status: SectionStatus
    position: int
    parent_slug: str | None
    content: str
    version: int
    updated_at: datetime
    updated_by: UserBrief | None
    tasks: list[TaskOut]
    children: list["SectionOut"] = []


class SectionCreate(BaseModel):
    slug: str = Field(pattern=SLUG_PATTERN)
    title: str = Field(min_length=1, max_length=200)
    group: SectionGroup = SectionGroup.main
    status: SectionStatus = SectionStatus.none
    parent_slug: str | None = None
    position: int | None = None
    content: str = ""


class SectionUpdate(BaseModel):
    version: int = Field(description="Version the edit is based on; mismatch → 409")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = None
    group: SectionGroup | None = None
    position: int | None = None


class StatusIn(BaseModel):
    status: str


# ---------- tasks ----------

class TaskCreate(BaseModel):
    code: str = Field(pattern=CODE_PATTERN)
    title: str = Field(min_length=1, max_length=300)
    kind: TaskKind = TaskKind.other
    section_slug: str | None = None
    status: TaskStatus = TaskStatus.todo
    assignee_id: int | None = None
    content: str = ""


class TaskUpdate(BaseModel):
    version: int
    title: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = None
    kind: TaskKind | None = None
    section_slug: str | None = None


class AssigneeIn(BaseModel):
    assignee_id: int | None


class Progress(BaseModel):
    total: int
    by_status: dict[TaskStatus, int]
    done: int


# ---------- revisions / activity / search ----------

class RevisionOut(ORM):
    id: int
    version: int
    title: str
    content: str
    created_at: datetime
    author: UserBrief | None


class ActivityOut(ORM):
    id: int
    action: str
    entity_type: str
    entity_key: str
    entity_label: str
    details: dict
    created_at: datetime
    user: UserBrief | None


class ActivityPage(BaseModel):
    items: list[ActivityOut]
    total: int


class MemberSummary(BaseModel):
    user: UserOut
    total: int
    edits: int
    status_changes: int
    last_active: datetime | None
    by_action: dict[str, int]


class SearchHit(BaseModel):
    type: str  # section | task
    key: str   # slug or code
    title: str
    page: str  # top-level section slug to open
    anchor: str
    snippet: str


class AnchorOut(BaseModel):
    page: str
    anchor: str


class MediaOut(BaseModel):
    url: str
