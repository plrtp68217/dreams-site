from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DREAMS_", env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'dreams.db').as_posix()}"
    media_dir: Path = BACKEND_DIR / "media"
    secret_key: str = DEFAULT_SECRET
    token_ttl_minutes: int = 60 * 24 * 7
    allow_registration: bool = True
    # Seed the database with the imported scenario on first start.
    seed_on_startup: bool = True
    # Optional bootstrap admin, created on startup if no user with this name exists.
    admin_username: str | None = None
    admin_password: str | None = None
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_upload_mb: int = 10


@lru_cache
def get_settings() -> Settings:
    return Settings()
