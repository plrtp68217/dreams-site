"""One-off conversion of the imported scenario to the "tasks are separate from the script" model.

The legacy site stored quests, art locations and open questions as cards with codes (FF-V01, LOC-FF-05, Q-07…),
and dialogue lines carried visible ids (FF-PA-03). It also contained our own proposals that are not part of the
scenario. This module:

* inlines the former task cards back into section text (keeping their anchor ids, so old links still work);
* replaces code mentions with human-readable names and hides line ids;
* removes proposals («Предложение» callouts, proposed lines and remarks).

Used by the startup migration (existing databases) and by tools/import_legacy.py (seed data).
"""
from __future__ import annotations

import html
import re
from collections.abc import Iterable

_PROPOSAL = re.compile(r'<div class="callout proposal"[^>]*>.*?</div>\s*', re.S)
_PROPOSED_LINE = re.compile(r'<div class="line[^"]*"[^>]*>(?:(?!</div>).)*?предложение(?:(?!</div>).)*?</div>\s*', re.S)
_LID = re.compile(r'<span class="lid">[^<]*</span>')
_EMPTY_TASK = r'<div data-task="{code}"></div>'
_NOTE_CODE = re.compile(r'(<div class="note")([^>]*>\s*<span class="who">)([^<]*?)\s+([A-Z]{2,}(?:-[A-Z0-9]+)+)(</span>)')

# Remarks and table rows that only existed as proposals.
_PROPOSAL_FRAGMENTS: list[tuple[str, str]] = [
    (" — см. предложение ниже", ""),
    (" Значения, не заданные сценарием, помечены как предложения.", ""),
    ("≥ 4 — расширенный финал уровня (предложение)", "Большинство — расширенный финал уровня"),
    (" Предложение: использовать их как стартовое состояние кафе и подменять сатирическими по мере искажения.", ""),
]
_PROPOSAL_ROW = re.compile(r"<tr>(?:(?!</tr>).)*?\(предложение\)(?:(?!</tr>).)*?</tr>\s*", re.S)
_PROPOSAL_LI = re.compile(r"<li>(?:(?!</li>).)*?добавлена как предложение(?:(?!</li>).)*?</li>\s*", re.S)
_PROPOSAL_P = re.compile(r"<p[^>]*><b>Предложение:</b>.*?</p>\s*", re.S)

# Hints about the legacy page's own UI (done-checkboxes on cards) that no longer exists.
_STALE_UI = [" Отмечайте задание галочкой, когда оно собрано в движке."]

# Ranges the legacy text used instead of a single code.
_RANGES = {"FF-V01…V07": "посетители", "FF-S01…S06": "побочные задания"}


def short_name(title: str) -> str:
    """«Зал: «Протрите столы»» → «Протрите столы» — the readable part used in running text."""
    if ": «" in title:
        return title.split(": ", 1)[1]
    if " — " in title:
        return title.split(" — ", 1)[0]
    return title


def remove_proposals(content: str) -> str:
    for old, new in _PROPOSAL_FRAGMENTS:
        content = content.replace(old, new)
    for pattern in (_PROPOSAL, _PROPOSED_LINE, _PROPOSAL_ROW, _PROPOSAL_LI, _PROPOSAL_P):
        content = pattern.sub("", content)
    return content


def _replace_codes_in_text(content: str, names: dict[str, str]) -> str:
    """Swap codes for names in text nodes only; outside links the name becomes a link to the card."""
    if not names:
        return content
    alternatives = sorted([*names, *_RANGES], key=len, reverse=True)
    pattern = re.compile(r"(?<![\w-])(" + "|".join(map(re.escape, alternatives)) + r")(?![\w-])")
    out: list[str] = []
    in_link = 0
    for part in re.split(r"(<[^>]+>)", content):
        if part.startswith("<"):
            if re.match(r"<a[\s>]", part):
                in_link += 1
            elif part.startswith("</a"):
                in_link = max(0, in_link - 1)
            out.append(part)
            continue

        def sub(m: re.Match) -> str:
            code = m.group(1)
            if code in _RANGES:
                return _RANGES[code]
            name = html.escape(names[code], quote=False)
            return name if in_link else f'<a href="#{code.lower()}">{name}</a>'

        out.append(pattern.sub(sub, part))
    return "".join(out)


def task_card(code: str, title: str, kind: str, content: str) -> str:
    return (
        f'<article class="quest kind-{kind}" id="{code.lower()}">'
        f"<header><h4>{html.escape(title, quote=False)}</h4></header>"
        f'<div class="qbody">{content}</div></article>'
    )


def readable_titles(tasks: Iterable[dict]) -> dict[str, str]:
    """Card titles, with code-only titles (open questions point at other cards) resolved to names."""
    tasks = list(tasks)
    names = {t["code"]: short_name(t["title"]) for t in tasks}
    if not names:
        return {}
    pattern = re.compile(r"(?<![\w-])(" + "|".join(map(re.escape, sorted(names, key=len, reverse=True))) + r")(?![\w-])")
    return {t["code"]: pattern.sub(lambda m: names[m.group(1)], t["title"]) for t in tasks}


def convert(sections: list[dict], tasks: list[dict]) -> None:
    """Rewrite each section's `content` in place. `tasks` items need code, title, kind, content."""
    titles = readable_titles(tasks)
    names = {t["code"]: short_name(titles[t["code"]]) for t in tasks}
    by_code = {t["code"]: t for t in tasks}
    for section in sections:
        content = section["content"]
        for code in re.findall(r'<div data-task="([^"]+)"></div>', content):
            task = by_code.get(code)
            card = task_card(code, titles[code], task["kind"], task["content"]) if task else ""
            content = content.replace(_EMPTY_TASK.format(code=code), card)
        content = remove_proposals(content)
        for hint in _STALE_UI:
            content = content.replace(hint, "")
        content = _LID.sub("", content)
        content = _NOTE_CODE.sub(lambda m: f'{m.group(1)} data-id="{m.group(4)}"{m.group(2)}{m.group(3)}{m.group(5)}',
                                 content)
        section["content"] = _replace_codes_in_text(content, names)
