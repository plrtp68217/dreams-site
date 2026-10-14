from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import Role, SectionGroup, SectionStatus, TaskKind, TaskStatus

USERNAME_PATTERN = r"^[A-Za-z0-9_.\-]{3,64}$"
SLUG_PATTERN = r"^[a-z0-9][a-z0-9\-]{0,79}$"
ANCHOR_PATTERN = r"^[A-Za-z0-9_\-]{1,80}$"


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
    avatar: str | None = None


class UserBrief(ORM):
    id: int
    username: str
    display_name: str
    avatar: str | None = None


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


class TaskBrief(ORM):
    id: int
    title: str
    kind: TaskKind
    status: TaskStatus
    assignee: UserBrief | None
    reviewer: UserBrief | None
    comments_count: int
    section_slug: str | None
    section_title: str | None
    page: str | None
    anchor: str | None
    anchor_label: str
    position: int
    updated_at: datetime


class TaskOut(TaskBrief):
    content: str
    content_html: str
    version: int
    created_at: datetime
    created_by: UserBrief | None
    updated_by: UserBrief | None


class SectionOut(ORM):
    id: int
    slug: str
    title: str
    group: SectionGroup
    status: SectionStatus
    position: int
    parent_slug: str | None
    source: str
    content: str
    version: int
    updated_at: datetime
    updated_by: UserBrief | None
    tasks: list[TaskBrief]
    children: list["SectionOut"] = []


class SectionCreate(BaseModel):
    slug: str = Field(pattern=SLUG_PATTERN)
    title: str = Field(min_length=1, max_length=200)
    group: SectionGroup = SectionGroup.main
    status: SectionStatus = SectionStatus.none
    parent_slug: str | None = None
    position: int | None = None
    source: str = Field(default="", max_length=500_000)


class SectionUpdate(BaseModel):
    version: int = Field(description="Version the edit is based on; mismatch → 409")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    source: str | None = Field(default=None, max_length=500_000)
    group: SectionGroup | None = None
    position: int | None = None


class StatusIn(BaseModel):
    status: str


# ---------- tasks ----------

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(default="", max_length=20000)
    kind: TaskKind = TaskKind.other
    status: TaskStatus = TaskStatus.todo
    assignee_id: int | None = None
    section_slug: str | None = None
    anchor: str | None = Field(default=None, pattern=ANCHOR_PATTERN)
    anchor_label: str = Field(default="", max_length=300)


class TaskUpdate(BaseModel):
    version: int
    title: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = Field(default=None, max_length=20000)
    kind: TaskKind | None = None
    # place in the scenario: send section_slug (and anchor/anchor_label) to change it, null to clear
    section_slug: str | None = None
    anchor: str | None = Field(default=None, pattern=ANCHOR_PATTERN)
    anchor_label: str | None = Field(default=None, max_length=300)


class AssigneeIn(BaseModel):
    assignee_id: int | None


class ReviewerIn(BaseModel):
    reviewer_id: int | None


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    # change the status together with the comment (the comment explains why)
    status: TaskStatus | None = None
    # «I am the reviewer»: become the task's reviewer
    set_reviewer: bool = False


class CommentOut(ORM):
    id: int
    text: str
    html: str
    status_from: TaskStatus | None
    status_to: TaskStatus | None
    created_at: datetime
    author: UserBrief | None


class CommentResult(BaseModel):
    comment: CommentOut
    task: "TaskOut"


class Progress(BaseModel):
    total: int
    by_status: dict[TaskStatus, int]
    done: int


# ---------- revisions / activity / search ----------

class RevisionOut(ORM):
    id: int
    version: int
    title: str
    # Markdown, as written
    content: str
    # rendered for viewing
    html: str = ""
    created_at: datetime
    author: UserBrief | None


class RenderIn(BaseModel):
    source: str = Field(max_length=500_000)


class RenderOut(BaseModel):
    html: str


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
    # actions per day ("2026-10-13": 4) for the last year, in the viewer's time zone
    days: dict[str, int] = {}


class SearchHit(BaseModel):
    type: str  # section | task
    key: str   # section slug or task number
    title: str
    page: str  # top-level section slug to open
    anchor: str
    snippet: str


class AnchorOut(BaseModel):
    page: str
    anchor: str


class MediaOut(BaseModel):
    url: str


# ---------- chats ----------

class ChatCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    # the creator is added automatically
    member_ids: list[int] = Field(default_factory=list, max_length=100)


class ChatUpdate(BaseModel):
    title: str = Field(max_length=200)


class ChatMembersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=100)


class ChatMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


class ChatReadIn(BaseModel):
    last_id: int


class ChatMessageOut(ORM):
    id: int
    chat_id: int
    text: str
    html: str
    created_at: datetime
    author: UserBrief | None


class ChatLastMessage(BaseModel):
    id: int
    # plain text, shortened
    text: str
    created_at: datetime
    author: UserBrief | None


class ChatOut(BaseModel):
    id: int
    title: str
    members: list[UserBrief]
    created_by: UserBrief | None
    created_at: datetime
    last_activity_at: datetime
    last_message: ChatLastMessage | None
    unread: int


class ChatUnread(BaseModel):
    # unread messages in all chats, and in how many chats
    messages: int
    chats: int
