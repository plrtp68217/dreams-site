from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_admin
from ..models import Role, User
from ..schemas import USERNAME_PATTERN, UserOut, UserUpdate
from ..security import hash_password
from ..services import log_activity

router = APIRouter(prefix="/api/users", tags=["users"])


class AdminCreateUser(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=128)
    role: Role = Role.viewer


class PasswordReset(BaseModel):
    password: str = Field(min_length=6, max_length=128)


def _get(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    return user


def _active_admins(db: Session) -> int:
    return db.scalar(select(func.count(User.id)).where(User.role == Role.admin, User.is_active.is_(True)))


@router.get("", response_model=list[UserOut])
def list_users(team_only: bool = False, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.created_at)
    if team_only:
        stmt = stmt.where(User.role.in_([Role.editor, Role.admin]), User.is_active.is_(True))
    return list(db.scalars(stmt))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: AdminCreateUser, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(func.lower(User.username) == data.username.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "Такой логин уже занят")
    user = User(
        username=data.username,
        display_name=(data.display_name or "").strip() or data.username,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.flush()
    log_activity(db, admin, "user.create", "user", user.username, user.display_name, role=data.role.value)
    db.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _get(db, user_id)
    losing_admin = user.role == Role.admin and user.is_active and (
        (data.role is not None and data.role != Role.admin) or data.is_active is False
    )
    if losing_admin and _active_admins(db) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя убрать последнего администратора")

    if data.role is not None and data.role != user.role:
        log_activity(db, admin, "user.role", "user", user.username, user.display_name,
                     **{"from": user.role.value, "to": data.role.value})
        user.role = data.role
    if data.is_active is not None and data.is_active != user.is_active:
        log_activity(db, admin, "user.active", "user", user.username, user.display_name,
                     **{"from": user.is_active, "to": data.is_active})
        user.is_active = data.is_active
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    db.commit()
    return user


@router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: int, data: PasswordReset, admin: User = Depends(require_admin),
                   db: Session = Depends(get_db)):
    user = _get(db, user_id)
    user.password_hash = hash_password(data.password)
    log_activity(db, admin, "user.password", "user", user.username, user.display_name)
    db.commit()
