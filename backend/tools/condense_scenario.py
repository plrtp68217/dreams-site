"""Publish the linear fast-food script to seed data and, optionally, a local SQLite DB.

From backend: python tools/condense_scenario.py [--apply-db dreams.db]
The database is backed up before changes; section IDs, tasks and history are kept.
Other dreams are not edited.
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db import Database
from app.html_to_markdown import html_to_markdown
from app.markup import render_scenario
from app.models import Section, SectionGroup, SectionStatus, utcnow
from app.services import snapshot


DATA = Path(__file__).resolve().parents[1] / "app/seed_data"
CHAPTERS = {
    "Начало сна": ("ff-entry", "1. Начало смены"),
    "Семь посетителей": ("ff-visitors", "2. Семь посетителей"),
    "Погоня и пробуждение": ("ff-final", "3. Погоня и пробуждение"),
}
REFERENCE = ["ff-locs", "ff-space", "ff-loop", "ff-clown", "ff-diary", "ff-side"]


def rewrite(data: dict) -> set[str]:
    sections = {item["slug"]: item for item in data["sections"]}
    changed = {"ff", *REFERENCE, "ff-reference", "items", "flags"}
    sections["ff"]["content"] = (
        "<p>Обслужить семь посетителей, собрать заказ клоуна, уйти от погони и вернуться в больницу. "
        "Посетители приходят строго по очереди. Следующий появляется после завершения предыдущего этапа.</p>"
    )
    chapters = (DATA / "fastfood.md").read_text(encoding="utf-8").split("## ")[1:]
    for position, chapter in enumerate(chapters):
        heading, source = chapter.split("\n", 1)
        slug, title = CHAPTERS[heading.strip()]
        section = sections[slug]
        section.update(title=title, position=position, parent="ff", group="levels")
        previous = section["content"]
        if slug == "ff-final":
            source = "#### Погоня и пробуждение\n\n" + source
        section["content"] = render_scenario(source.strip() + "\n", previous)
        if slug == "ff-final":
            final = BeautifulSoup(section["content"], "html.parser")
            final.h4["data-id"] = "ff-branch"
            section["content"] = str(final)
        changed.add(slug)

    if "ff-reference" not in sections:
        reference = dict(slug="ff-reference", title="Фастфуд: материалы для разработки", group="reference",
                         status="part", parent=None, position=14, content="")
        data["sections"].append(reference)
        sections["ff-reference"] = reference
    sections["ff-reference"]["content"] = "<p>Арты, игровые условия и список данных, которых не хватает для реализации. Прохождение — в разделе «Сон 1: Заброшенный фастфуд».</p>"
    for position, slug in enumerate(REFERENCE):
        sections[slug].update(parent="ff-reference", group="reference", position=position)

    # Preserve the art and its existing anchors; remove quest analysis from the art catalogue.
    art = BeautifulSoup(sections["ff-locs"]["content"], "html.parser")
    cards = []
    for card in art.select("article"):
        header = card.find("header")
        images = "".join(str(img) for img in card.find_all("img"))
        anchor = card.get("data-id") or card.get("id")
        if header and images and anchor:
            cards.append(f'<article class="quest" data-id="{anchor}">{header}<div class="qbody">{images}</div></article>')
    sections["ff-locs"]["content"] = "".join(cards)
    sections["ff-space"]["content"] = render_scenario(
        "Касса — приём и выдача заказов. Кухня — сбор еды. Уборная — лицо первого посетителя. "
        "Зал ожидания — талон бабушки. Детская зона — игрушка и «Первый сон». Раздевалка — ключ и бейджик. "
        "Кабинет — печать, согласие и «Настоящая причина». Окно выдачи — место с фотографии. "
        "Фритюрница — соус «Вспомни». Терминал доставки — подпись. Выход — применение подписанного документа.\n"
    )
    sections["ff-loop"]["content"] = render_scenario(
        "Посетитель подходит → Ева получает поручение → выполняет действия этапа → возвращается к кассе → приходит следующий посетитель.\n"
    )
    sections["ff-clown"]["content"] = render_scenario(
        "До седьмого посетителя клоун появляется в отражениях, плакатах, игрушках и на экранах. "
        "После выдачи шестипозиционного заказа превращается в преследователя. Погоня заканчивается за дверью, открытой подписанным документом.\n"
    )
    sections["ff-diary"]["content"] = render_scenario(
        "1. После первого посетителя — фрагмент медкарты.\n"
        "2. После девочки — рисунок «Я сама разрешила?».\n"
        "3. После печати на согласии — запись «Согласие».\n"
        "4. После курьера — студенческий билет и воспоминание об исследовательской программе.\n"
        "5. После пробуждения — салфетка с записью об эксперименте №1.\n"
    )
    sections["ff-diary"]["title"] = "Улики по порядку"
    sections["ff-side"].update(title="Недостающие данные для реализации", status="part", content=render_scenario(
        "- Задать предметы и взаимодействия для позиций «Первый сон», «Настоящая причина» и «Подпись». В исходнике указаны только места.\n"
        "- Задать маршрут погони, скорость клоуна, условия поимки и точку повторного старта.\n"
        "- Задать подсказку к ответу проверки и выбору игрушки, а также последствия неверных действий.\n"
        "- Уточнить, что получает мужчина с печатью после заверения формы согласия.\n"
    ))
    # Keep the shared reference lists consistent with the mandatory route.
    sections["items"]["content"] = render_scenario(
        "| Предмет | Получение | Применение |\n|---|---|---|\n"
        "| Салфетка | Уборная | Протереть зеркало |\n"
        "| Талон | Зал ожидания | Выдать заказ бабушке |\n"
        "| Монета | Бабушка | Доступ в детскую зону |\n"
        "| Маленькая койка | Автомат | Выдать заказ девочке |\n"
        "| Ключ / пропуск | Раздевалка | Открыть кабинет |\n"
        "| Печать | Кабинет | Заверить согласие |\n"
        "| Посылка | Курьер | Получить браслет, студбилет, чек, фото и салфетку |\n"
        "| Бейджик | Раздевалка | «Имя Евы» для клоуна |\n"
        "| «Первый сон» | Детская зона | Заказ клоуна |\n"
        "| «Настоящая причина» | Кабинет | Заказ клоуна |\n"
        "| Соус «Вспомни» | Фритюрница | Заказ клоуна |\n"
        "| Чек | Касса | Заказ клоуна |\n"
        "| Подпись | Терминал доставки | Заказ клоуна |\n"
        "| Подписанный документ | Клоун | Открыть выход |\n"
        "| Настоящая салфетка | Пробуждение | Прочитать запись об эксперименте |\n"
    )
    sections["flags"]["content"] = render_scenario(
        "- Текущий этап: посетители 1–7 → погоня → пробуждение.\n"
        "- Завершённые действия текущего посетителя и выданные сюжетные улики.\n"
        "- Наличие монеты, доступа в детскую зону и ключа от кабинета.\n"
        "- Собранные позиции заказа клоуна: 0–6. Выдать заказ можно только при наличии всех шести.\n"
        "- Наличие подписанного документа: требуется для выхода.\n"
        "- Счётчика побочных заданий и ветвления финала нет.\n"
    )
    # Remove obsolete fast-food side-quest questions from the shared list.
    questions = BeautifulSoup(sections["open"]["content"], "html.parser")
    for number in [10, 11, 12, 14, 15, 17]:
        question = questions.find(id=f"q-{number:02}") or questions.find(attrs={"data-id": f"q-{number:02}"})
        if question:
            question.decompose()
    sections["open"]["content"] = str(questions)
    changed.add("open")
    # The seed loader attaches parents as it inserts sections.
    reference = sections["ff-reference"]
    ordered = [item for item in data["sections"] if item["slug"] != "ff-reference"]
    first_reference = next(i for i, item in enumerate(ordered) if item["slug"] in REFERENCE)
    ordered.insert(first_reference, reference)
    data["sections"] = ordered
    return changed


def apply_database(path: Path, data: dict, slugs: set[str]) -> None:
    path = path.resolve(strict=True)
    backup = path.with_name(f"{path.stem}.before-fastfood-{datetime.now():%Y%m%d-%H%M%S-%f}{path.suffix}")
    with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    database = Database(f"sqlite:///{path.as_posix()}")
    try:
        with database.SessionLocal.begin() as db:
            existing = {section.slug: section for section in db.scalars(select(Section))}
            for item in data["sections"]:
                if item["slug"] not in slugs:
                    continue
                section = existing.get(item["slug"])
                if section is None:
                    section = Section(slug=item["slug"])
                    db.add(section)
                    existing[section.slug] = section
                source = html_to_markdown(item["content"])
                values = (item["title"], source, item["position"], item["parent"], item["group"], item["status"])
                old = (section.title, section.source, section.position, section.parent_slug,
                       section.group.value if section.group else None, section.status.value if section.status else None)
                if values == old:
                    continue
                if section.id is not None:
                    snapshot(db, section, "section")
                    section.version += 1
                section.title = item["title"]
                section.source = source
                section.content = render_scenario(source, item["content"])
                section.position = item["position"]
                section.group = SectionGroup(item["group"])
                section.status = SectionStatus(item["status"])
                section.updated_at = utcnow()
            # Resolve parents after the new reference section has been created.
            for item in data["sections"]:
                if item["slug"] in slugs:
                    existing[item["slug"]].parent = existing.get(item["parent"])
    finally:
        database.engine.dispose()
    print(f"Updated fast-food script. Backup: {backup.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply-db", type=Path)
    args = parser.parse_args()
    seed = DATA / "scenario.json"
    data = json.loads(seed.read_text(encoding="utf-8"))
    slugs = rewrite(data)
    seed.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if args.apply_db:
        apply_database(args.apply_db, data, slugs)


if __name__ == "__main__":
    main()
