from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_current_user, get_db, get_settings_dep
from ..models import Role, User
from ..schemas import ChangePasswordIn, LoginIn, RegisterIn, TokenOut, UserOut
from ..security import create_token, hash_password, verify_password
from ..services import log_activity

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token(user: User, settings: Settings) -> TokenOut:
    token = create_token(user.id, settings.secret_key, settings.token_ttl_minutes)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(data: RegisterIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    if not settings.allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Регистрация отключена")
    if db.scalar(select(User).where(func.lower(User.username) == data.username.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "Такой логин уже занят")
    # The very first account becomes the administrator; everyone else starts as a viewer.
    is_first = db.scalar(select(func.count(User.id))) == 0
    user = User(
        username=data.username,
        display_name=(data.display_name or "").strip() or data.username,
        password_hash=hash_password(data.password),
        role=Role.admin if is_first else Role.viewer,
    )
    db.add(user)
    db.flush()
    log_activity(db, user, "user.register", "user", user.username, user.display_name)
    db.commit()
    return _token(user, settings)


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    user = db.scalar(select(User).where(func.lower(User.username) == data.username.lower()))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Учётная запись отключена")
    return _token(user, settings)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(data: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.old_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль указан неверно")
    user.password_hash = hash_password(data.new_password)
    db.add(user)
    db.commit()
