"""Team chats. Only members of a chat see it; nothing from chats goes to the (public) activity feed."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..deps import get_db, require_team
from ..models import Chat, ChatMember, ChatMessage, Role, User
from ..schemas import (
    ChatCreate,
    ChatLastMessage,
    ChatMembersIn,
    ChatMessageIn,
    ChatMessageOut,
    ChatOut,
    ChatReadIn,
    ChatUnread,
    ChatUpdate,
    UserBrief,
)

router = APIRouter(prefix="/api/chats", tags=["chats"])

PREVIEW_LENGTH = 140


def _preview(text: str) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= PREVIEW_LENGTH else flat[: PREVIEW_LENGTH - 1].rstrip() + "…"


def _membership(db: Session, chat_id: int, user: User) -> ChatMember:
    """The user's membership; a chat the user is not in does not exist for them."""
    member = db.get(ChatMember, (chat_id, user.id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Чат не найден")
    return member


def _team_members(db: Session, ids: list[int]) -> list[User]:
    users = list(db.scalars(select(User).where(User.id.in_(set(ids))))) if ids else []
    if len(users) != len(set(ids)) or any(not u.is_active or not u.role.in_team for u in users):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "В чат можно добавить только участников команды")
    return users


def _unread_counts(db: Session, user: User, chat_ids: list[int] | None = None) -> dict[int, int]:
    """Messages from others newer than what the user has read, per chat."""
    stmt = (
        select(ChatMessage.chat_id, func.count(ChatMessage.id))
        .join(ChatMember, and_(ChatMember.chat_id == ChatMessage.chat_id, ChatMember.user_id == user.id))
        .where(ChatMessage.id > ChatMember.last_read_id,
               or_(ChatMessage.author_id.is_(None), ChatMessage.author_id != user.id))
        .group_by(ChatMessage.chat_id)
    )
    if chat_ids is not None:
        stmt = stmt.where(ChatMessage.chat_id.in_(chat_ids))
    return dict(db.execute(stmt).all())


def _out(db: Session, chats: list[Chat], user: User) -> list[ChatOut]:
    ids = [c.id for c in chats]
    unread = _unread_counts(db, user, ids)
    last_ids = select(func.max(ChatMessage.id)).where(ChatMessage.chat_id.in_(ids)).group_by(ChatMessage.chat_id)
    last = {m.chat_id: m for m in db.scalars(select(ChatMessage).where(ChatMessage.id.in_(last_ids)))} if ids else {}
    result = []
    for chat in chats:
        msg = last.get(chat.id)
        result.append(ChatOut(
            id=chat.id,
            title=chat.title,
            members=[UserBrief.model_validate(m.user) for m in chat.members],
            created_by=UserBrief.model_validate(chat.created_by) if chat.created_by else None,
            created_at=chat.created_at,
            last_activity_at=chat.last_activity_at,
            last_message=ChatLastMessage(
                id=msg.id, text=_preview(msg.text), created_at=msg.created_at,
                author=UserBrief.model_validate(msg.author) if msg.author else None,
            ) if msg else None,
            unread=unread.get(chat.id, 0),
        ))
    return result


def _one(db: Session, chat: Chat, user: User) -> ChatOut:
    return _out(db, [chat], user)[0]


def _direct_chat(db: Session, a: User, b: User) -> Chat | None:
    """An existing untitled chat of exactly these two people."""
    mine = select(ChatMember.chat_id).where(ChatMember.user_id == a.id)
    theirs = select(ChatMember.chat_id).where(ChatMember.user_id == b.id)
    for chat in db.scalars(select(Chat).where(Chat.title == "", Chat.id.in_(mine), Chat.id.in_(theirs))):
        if len(chat.members) == 2:
            return chat
    return None


@router.get("", response_model=list[ChatOut])
def list_chats(user: User = Depends(require_team), db: Session = Depends(get_db)):
    mine = select(ChatMember.chat_id).where(ChatMember.user_id == user.id)
    chats = list(db.scalars(select(Chat).where(Chat.id.in_(mine)).order_by(Chat.last_activity_at.desc(), Chat.id.desc())))
    return _out(db, chats, user)


@router.get("/unread", response_model=ChatUnread)
def unread(user: User = Depends(require_team), db: Session = Depends(get_db)):
    counts = _unread_counts(db, user)
    return ChatUnread(messages=sum(counts.values()), chats=len(counts))


@router.post("", response_model=ChatOut, status_code=status.HTTP_201_CREATED)
def create(data: ChatCreate, response: Response, user: User = Depends(require_team), db: Session = Depends(get_db)):
    title = data.title.strip()
    others = [u for u in _team_members(db, data.member_ids) if u.id != user.id]
    if not others:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Выберите, с кем переписываться")
    if not title and len(others) == 1:
        existing = _direct_chat(db, user, others[0])
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return _one(db, existing, user)
    chat = Chat(title=title, created_by=user)
    chat.members = [ChatMember(user=u) for u in [user, *others]]
    db.add(chat)
    db.commit()
    return _one(db, chat, user)


@router.get("/{chat_id}", response_model=ChatOut)
def read(chat_id: int, user: User = Depends(require_team), db: Session = Depends(get_db)):
    return _one(db, _membership(db, chat_id, user).chat, user)


@router.patch("/{chat_id}", response_model=ChatOut)
def rename(chat_id: int, data: ChatUpdate, user: User = Depends(require_team), db: Session = Depends(get_db)):
    chat = _membership(db, chat_id, user).chat
    chat.title = data.title.strip()
    db.commit()
    return _one(db, chat, user)


@router.post("/{chat_id}/members", response_model=ChatOut)
def add_members(chat_id: int, data: ChatMembersIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    chat = _membership(db, chat_id, user).chat
    present = {m.user_id for m in chat.members}
    newcomers = [u for u in _team_members(db, data.user_ids) if u.id not in present]
    if newcomers and not chat.title and len(chat.members) == 2:
        # a direct chat that grows is no longer direct: give it a name so it is not mistaken for one
        chat.title = ", ".join(m.user.display_name for m in chat.members)
    # newcomers see the whole history but start with nothing unread
    last_id = db.scalar(select(func.max(ChatMessage.id)).where(ChatMessage.chat_id == chat.id)) or 0
    for u in newcomers:
        chat.members.append(ChatMember(user=u, last_read_id=last_id))
    db.commit()
    return _one(db, chat, user)


@router.delete("/{chat_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(chat_id: int, user_id: int, user: User = Depends(require_team), db: Session = Depends(get_db)):
    """Leave a chat, or (creator or admin) remove someone from it. The last one out deletes the chat."""
    chat = _membership(db, chat_id, user).chat
    if user_id != user.id and chat.created_by_id != user.id and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Убрать участника может только создатель чата или администратор")
    member = db.get(ChatMember, (chat_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Такого участника в чате нет")
    chat.members.remove(member)
    if not chat.members:
        db.delete(chat)
    db.commit()


@router.get("/{chat_id}/messages", response_model=list[ChatMessageOut])
def messages(
    chat_id: int,
    after: int | None = None,
    before: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_team),
    db: Session = Depends(get_db),
):
    """Oldest first. Without `after` — the latest `limit` messages (before `before`, to scroll back);
    with `after` — everything new since that message (polling)."""
    _membership(db, chat_id, user)
    stmt = select(ChatMessage).where(ChatMessage.chat_id == chat_id)
    if after is not None:
        return list(db.scalars(stmt.where(ChatMessage.id > after).order_by(ChatMessage.id).limit(limit)))
    if before is not None:
        stmt = stmt.where(ChatMessage.id < before)
    return list(reversed(db.scalars(stmt.order_by(ChatMessage.id.desc()).limit(limit)).all()))


@router.post("/{chat_id}/messages", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
def send(chat_id: int, data: ChatMessageIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    member = _membership(db, chat_id, user)
    text = data.text.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Сообщение пустое")
    message = ChatMessage(chat_id=chat_id, author=user, text=text)
    db.add(message)
    db.flush()
    member.last_read_id = message.id
    member.chat.last_activity_at = message.created_at
    db.commit()
    return message


@router.put("/{chat_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(chat_id: int, data: ChatReadIn, user: User = Depends(require_team), db: Session = Depends(get_db)):
    member = _membership(db, chat_id, user)
    if data.last_id > member.last_read_id:
        member.last_read_id = data.last_id
        db.commit()


@router.delete("/{chat_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(chat_id: int, message_id: int, user: User = Depends(require_team), db: Session = Depends(get_db)):
    _membership(db, chat_id, user)
    message = db.get(ChatMessage, message_id)
    if message is None or message.chat_id != chat_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сообщение не найдено")
    if message.author_id != user.id and user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Удалить сообщение может только автор или администратор")
    db.delete(message)
    db.commit()
