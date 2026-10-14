import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_current_user, get_db, get_settings_dep, require_team
from ..html_utils import html_to_text, snippet
from ..models import Section, Task, User
from ..markup import render_scenario
from ..schemas import AnchorOut, MediaOut, RenderIn, RenderOut, SearchHit
from ..services import log_activity

router = APIRouter(prefix="/api", tags=["misc"])

# magic bytes → extension
IMAGE_SIGNATURES = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpg",
    b"GIF87a": "gif",
    b"GIF89a": "gif",
}


def image_ext(head: bytes) -> str | None:
    for sig, ext in IMAGE_SIGNATURES.items():
        if head.startswith(sig):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


@router.get("/site")
def site(request: Request, settings: Settings = Depends(get_settings_dep)):
    """Public info for the login screen."""
    return {"hero": request.app.state.hero, "allow_registration": settings.allow_registration}


@router.get("/search", response_model=list[SearchHit])
def search(q: str = Query(min_length=2, max_length=100), _: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    # SQLite's LOWER() is ASCII-only, so Cyrillic matching is done in Python; the corpus is small.
    needle = q.strip().lower()
    scored: list[tuple[int, int, SearchHit]] = []

    def rank(code: str, title: str, text: str) -> int | None:
        if code.lower() == needle:
            return 0
        if needle in title.lower() or needle in code.lower():
            return 1
        if needle in text.lower():
            return 2
        return None

    for s in db.scalars(select(Section).order_by(Section.position)):
        text = html_to_text(s.content)
        r = rank(s.slug, s.title, text)
        if r is not None:
            scored.append((r, len(scored), SearchHit(type="section", key=s.slug, title=s.title, page=s.top().slug,
                                                     anchor=s.slug, snippet=snippet(text, q))))
    for t in db.scalars(select(Task).order_by(Task.position)):
        r = rank(f"#{t.id}", t.title, t.content)
        if r is not None:
            scored.append((r, len(scored), SearchHit(type="task", key=str(t.id), title=f"#{t.id} · {t.title}",
                                                     page="", anchor="", snippet=snippet(t.content, q))))
    hits = [hit for _, _, hit in sorted(scored, key=lambda x: (x[0], x[1]))]
    return hits[:60]


@router.post("/render", response_model=RenderOut)
def render(data: RenderIn, _: User = Depends(require_team)):
    """Preview for the editor: scenario Markdown → HTML exactly as it will be saved."""
    return RenderOut(html=render_scenario(data.source))


@router.get("/anchors/{anchor}", response_model=AnchorOut)
def resolve_anchor(anchor: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Map an in-page anchor (#ff-v01, #ff-branch, a line id…) to the page that shows it."""
    section = db.scalar(select(Section).where(Section.slug == anchor))
    if section:
        return AnchorOut(page=section.top().slug, anchor=anchor)
    for marker in (f'id="{anchor}"', f'data-id="{anchor}"'):
        section = db.scalar(select(Section).where(Section.content.contains(marker)))
        if section:
            return AnchorOut(page=section.top().slug, anchor=anchor)
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Ссылка никуда не ведёт")


@router.post("/media", response_model=MediaOut, status_code=status.HTTP_201_CREATED)
async def upload(
    file: UploadFile = File(...),
    user: User = Depends(require_team),
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
):
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Файл больше {settings.max_upload_mb} МБ")
    ext = image_ext(data[:16])
    if ext is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Можно загружать только PNG, JPEG, GIF или WebP")
    name = f"upload-{uuid.uuid4().hex[:16]}.{ext}"
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    (settings.media_dir / name).write_bytes(data)
    url = f"/media/{name}"
    log_activity(db, user, "media.upload", "media", name, file.filename or name)
    db.commit()
    return MediaOut(url=url)
