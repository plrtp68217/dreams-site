"""Convert the legacy single-file site (legacy/index.html) into seed data.

Produces:
  app/seed_data/scenario.json  — sections and tasks
  media/legacy-*.{png,jpg,webp} — images extracted from data: URIs

Usage (from backend/):  python tools/import_legacy.py ../legacy/index.html
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, Tag

BACKEND = Path(__file__).resolve().parent.parent
MEDIA_DIR = BACKEND / "media"
OUT = BACKEND / "app" / "seed_data" / "scenario.json"

EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
DATA_URI = re.compile(r"^data:(image/[a-z+]+);base64,(.+)$", re.S)

_saved: dict[str, str] = {}


def save_image(src: str) -> str:
    m = DATA_URI.match(src)
    if not m:
        return src
    mime, payload = m.groups()
    raw = base64.b64decode(payload)
    digest = hashlib.sha1(raw).hexdigest()[:12]
    if digest not in _saved:
        name = f"legacy-{digest}.{EXT.get(mime, 'bin')}"
        (MEDIA_DIR / name).write_bytes(raw)
        _saved[digest] = f"/media/{name}"
    return _saved[digest]


def inner_html(tag: Tag) -> str:
    return "".join(str(c) for c in tag.contents).strip()


def clean(tag: Tag) -> None:
    """Drop presentation-only attributes that the new app re-creates itself."""
    for el in tag.find_all(True):
        classes = [c for c in el.get("class", []) if c != "searchable"]
        if classes:
            el["class"] = classes
        elif el.has_attr("class"):
            del el["class"]
        if el.name == "img":
            el["src"] = save_image(el.get("src", ""))
            el["loading"] = "lazy"
    for btn in tag.select("button.copy"):
        btn.decompose()


def main(src: Path) -> None:
    MEDIA_DIR.mkdir(exist_ok=True)
    soup = BeautifulSoup(src.read_text(encoding="utf-8"), "html.parser")

    # --- navigation: titles, groups, statuses, parent/child ---
    nav = soup.select_one("aside.nav")
    meta: dict[str, dict] = {}
    group = "main"
    position = 0
    for el in nav.children:
        if not isinstance(el, Tag):
            continue
        if el.name == "p" and "grp" in el.get("class", []):
            group = {"Уровни": "levels", "Справочник": "reference"}.get(el.get_text(strip=True), "main")
        if el.name != "ol":
            continue
        for li in el.find_all("li", recursive=False):
            a = li.find("a", recursive=False)
            slug = a["href"][1:]
            dot = a.find("span", class_="dot")
            status = next((c for c in dot.get("class", []) if c != "dot"), "none") if dot else "none"
            meta[slug] = {"title": a.get_text(strip=True), "group": group, "status": status,
                          "parent": None, "position": position}
            position += 1
            sub = li.find("ol")
            if sub:
                for child_pos, sa in enumerate(sub.select("a")):
                    cslug = sa["href"][1:]
                    meta[cslug] = {"title": sa.get_text(strip=True), "group": group, "status": status,
                                   "parent": slug, "position": child_pos}

    hero = soup.select_one(".hero img")
    hero_url = save_image(hero["src"]) if hero else None

    sections: list[dict] = []
    tasks: list[dict] = []

    for sec in soup.select("main section[id]"):
        slug = sec["id"]
        info = meta[slug]
        clean(sec)

        heading = sec.find(["h2", "h3"], recursive=False)
        if heading:
            heading.decompose()
        badge = sec.find("span", class_="status", recursive=False)
        if badge:
            badge.decompose()

        # quests → tasks
        for art in sec.select("article.quest"):
            code = art["data-qid"]
            body = art.select_one(".qbody")
            tasks.append({"code": code, "kind": "quest", "title": art.select_one("header h4").get_text(strip=True),
                          "section": slug, "status": "todo", "content": inner_html(body)})
            art.replace_with(BeautifulSoup(f'<div data-task="{code}"></div>', "html.parser"))

        # art locations → tasks
        for fig in sec.select("figure.loc"):
            head = fig.select_one(".loc-head")
            code = head.select_one(".qid").get_text(strip=True)
            title = head.select_one("h4").get_text(strip=True)
            head.decompose()
            cap = fig.find("figcaption")
            media = [c for c in fig.children if isinstance(c, Tag) and c.name != "figcaption"]
            media_html = "".join(str(m) for m in media)
            content = f'<div class="loc-media">{media_html}</div>{inner_html(cap)}'
            tasks.append({"code": code, "kind": "art", "title": title, "section": slug,
                          "status": "todo", "content": content})
            fig.replace_with(BeautifulSoup(f'<div data-task="{code}"></div>', "html.parser"))

        # open questions table → tasks
        if slug == "open":
            table = sec.select_one(".tbl-wrap")
            placeholders = []
            for i, row in enumerate(table.select("tbody tr"), start=1):
                where, question = row.find_all("td")
                code = f"Q-{i:02d}"
                tasks.append({"code": code, "kind": "question", "title": where.get_text(strip=True),
                              "section": slug, "status": "todo", "content": f"<p>{inner_html(question)}</p>"})
                placeholders.append(f'<div data-task="{code}"></div>')
            table.replace_with(BeautifulSoup("".join(placeholders), "html.parser"))

        sections.append({"slug": slug, "title": info["title"], "group": info["group"],
                         "status": info["status"], "parent": info["parent"], "position": info["position"],
                         "content": inner_html(sec)})

    for pos, t in enumerate(tasks):
        t["position"] = pos

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"hero": hero_url, "sections": sections, "tasks": tasks},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"sections={len(sections)} tasks={len(tasks)} images={len(_saved)} -> {OUT}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else BACKEND.parent / "legacy" / "index.html"))
