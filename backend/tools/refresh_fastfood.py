"""Import only the current visitor notes, never the obsolete combined PDF."""
import json
import re
import shutil
from html import escape
from pathlib import Path

import pymupdf
from bs4 import BeautifulSoup


def main():
    root = Path(r"C:\Users\moroz\Desktop\DEV\UNITY\ArtDatabase_Merged\FastFood\scenarios")
    target = Path(__file__).resolve().parents[1] / "app/seed_data/scenario.json"
    data = json.loads(target.read_text(encoding="utf-8"))
    sections = {s["slug"]: s for s in data["sections"]}
    notes = [(root / name).read_text(encoding="utf-8-sig") for name in
             ("01_faceless_man.txt", "02_granny_cart.txt")]
    with pymupdf.open(next((root / "03_burger").glob("*.pdf"))) as doc:
        pages = []
        for page in doc:
            lines = [line for line in page.get_text().splitlines()
                     if not line.startswith("DREAMS")]
            pages.append("\n".join(lines))
        lines = []
        for line in "\n".join(pages).splitlines():
            if not line.strip():
                continue
            if (lines and not re.match(r"^(\d+\.|Результат:|•|Условия|Интерфейс|Референсы|Задание:|После обслуживания)", line)
                    and not lines[-1].endswith((".", ":", "»"))):
                lines[-1] += " " + line
            else:
                lines.append(line)
        notes.append("\n\n".join(lines))
    visitors = BeautifulSoup(sections["ff-visitors"]["content"], "html.parser")
    portraits = {1: "granny", 2: "burger", 4: "seal-man", 5: "soldier-courier", 6: "clown"}
    for index, card in enumerate(visitors.find_all("article")):
        body = card.select_one(".qbody")
        body.clear()
        if index in portraits:
            name = portraits[index]
            filename = f"fastfood-{name}.png"
            shutil.copy2(root.parent / "art/characters" / f"{name}.png",
                         target.parents[2] / "media" / filename)
            image = visitors.new_tag("img", src=f"/media/{filename}", alt=card.h4.get_text(), loading="lazy")
            body.append(image)
        for line in (notes[index].splitlines() if index < 3 else ["Сценарий на этапе разработки."]):
            if line.strip():
                p = visitors.new_tag("p")
                p.string = line
                body.append(p)
    sections["ff-visitors"]["content"] = str(visitors)
    updates = {
        "ff": "Написаны сценарии первых трёх посетителей. Сценарии остальных гостей на этапе разработки.",
        "ff-entry": "Сценарий начала смены на этапе разработки.",
        "ff-final": "Сценарий завершения смены на этапе разработки.",
        "ff-reference": "Материалы по трём написанным сценариям. Прохождение — в разделе «Посетители».",
        "ff-space": "Мужчина без лица: фритюрница, холодильник, автомат с напитками, уборная. Бабушка: автомат талонов, холодильник, фритюрница, соусная станция. Человек-бургер: касса, комната персонала.",
        "ff-loop": "Полностью собранный заказ относим гостю. После первых двух гостей человек-бургер поручает найти потерянный бейдж.",
        "ff-side": "Условия поручения «Сотрудник месяца» приведены в сценарии человека-бургера.",
        "ff-clown": "Во время ожидания талона клоун заглядывает чаще обычного и торопит игрока. Сценарий клоуна как посетителя на этапе разработки.",
        "ff-diary": "Осмотр фотографии Евы перед палатой №307 из конверта открывает запись «Смена №001»: «Первая смена? Но я уже была здесь... Сколько их было на самом деле?»",
        "art-review": "Изображения гостей приведены в карточках посетителей. Сценарии остальных гостей на этапе разработки.",
        "items": "Мужчина без лица: бургер без булки, картошка без соли, напиток без вкуса, игрушка без лица. Бабушка: талон «за терпение», картошка, соус. Человек-бургер: бейдж «Сотрудник месяца», фотография Евы рядом с Бургером в шкафчике, конверт с фотографией перед палатой №307.",
        "flags": "Талон: шкала сбрасывается при движении или действии. Картошка: раньше — сырая, вовремя — золотая, позже — подгоревшая. Шкафчик №4: код 641; неверный код оставляет шкафчик закрытым. Бейдж доступен после открытия шкафчика. Конверт появляется после передачи бейджа. Запись в дневнике открывается после осмотра фотографии из конверта.",
    }
    for slug, text in updates.items():
        sections[slug]["content"] = f"<p>{escape(text)}</p>"
    sections["ff-final"]["content"] = '<h4 data-id="ff-branch">Завершение смены</h4>' + sections["ff-final"]["content"]
    sections["ff-final"]["title"] = "3. Завершение смены"
    for slug in ("ff", "ff-visitors", "ff-reference"):
        sections[slug]["status"] = "part"
    for slug in ("ff-entry", "ff-final"):
        sections[slug]["status"] = "none"
    locs = BeautifulSoup(sections["ff-locs"]["content"], "html.parser")
    for card in locs.find_all("article"):
        body = card.select_one(".qbody")
        body.clear()
        p = locs.new_tag("p")
        p.string = "Материалы на этапе разработки."
        body.append(p)
    sections["ff-locs"]["content"] = str(locs)
    # Shared reference pages must not continue presenting removed events as facts.
    cast = BeautifulSoup(sections["cast"]["content"], "html.parser")
    for row in list(cast.select("tbody tr")):
        cells = row.find_all("td")
        if len(cells) > 1 and (cells[1].get_text() == "Сон 1" or cells[0].get_text() == "Семь посетителей"):
            row.decompose()
    for cell in cast.find_all("td"):
        if "Лицо врача мелькает" in cell.get_text():
            cell.string = "Пока без имён и реплик."
    sections["cast"]["content"] = str(cast)
    questions = BeautifulSoup(sections["open"]["content"], "html.parser")
    for card in list(questions.find_all("article")):
        if card.h4 and card.h4.get_text() in {"Арт Сна 1", "Фасад и парковка", "Арт посетителей", "Девушка в форме", "Бренд", "Девочка из детской зоны", "Человек в костюме бургера", "Сон 1"}:
            card.decompose()
    sections["open"]["content"] = str(questions)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (target.parent / "fastfood.md").write_text("\n\n".join(notes) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
