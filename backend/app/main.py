import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import BACKEND_DIR, DEFAULT_SECRET, Settings, get_settings
from .db import Database
from .routers import activity, auth, chats, misc, sections, tasks, users
from .seed import ensure_admin, load_seed, seed_scenario


def _persistent_secret() -> str:
    """Generate a signing key once and keep it next to the database, so tokens survive restarts."""
    path = BACKEND_DIR / ".secret_key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    if settings.secret_key == DEFAULT_SECRET:
        settings.secret_key = _persistent_secret()
    database = Database(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database.create_all()
        seed = load_seed()
        app.state.hero = seed.get("hero")
        db = database.SessionLocal()
        try:
            if settings.seed_on_startup:
                seed_scenario(db, seed)
            if settings.admin_username and settings.admin_password:
                ensure_admin(db, settings.admin_username, settings.admin_password)
        finally:
            db.close()
        yield
        database.engine.dispose()

    app = FastAPI(title="DREAMS — сценарий", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = database
    app.state.hero = None

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module in (auth, users, sections, tasks, chats, activity, misc):
        app.include_router(module.router)

    settings.media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")

    @app.get("/api/health", include_in_schema=False)
    def health():
        return {"ok": True}

    return app


app = create_app()
