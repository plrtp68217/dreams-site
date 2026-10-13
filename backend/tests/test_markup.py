from app.html_to_markdown import html_to_markdown
from app.html_utils import sanitize_html
from app.markup import parse_blocks, render_markdown, render_scenario


def test_dialogue_lines_and_flags():
    html = render_markdown("> **Клоун:** Ты *заказала* это сама.\n> *Громкая связь*: Касса закрыта.\n\nФлаг `ff_side_done`.")
    assert '<div class="line"><span class="who">Клоун</span><q>Ты <em>заказала</em> это сама.</q></div>' in html
    assert '<div class="line ann"><span class="who">Громкая связь</span><q>Касса закрыта.</q></div>' in html
    assert '<span class="flag">ff_side_done</span>' in html
    # a quote without a speaker stays a quote
    assert "<blockquote>" in render_markdown("> просто цитата")


def test_containers():
    src = """::: заметка Важно
Текст **заметки**.
:::

::: нет-в-сценарии
Нет арта.
:::

::: записка Салфетка
Строка один
Строка два
:::

::: карточка Касса
::: заметка Вложенная
внутри
:::
:::

::: вводка
Вступление.
:::

::: странное Что-то
текст
:::"""
    html = render_markdown(src)
    assert '<div class="callout"><b class="tag">Важно</b><p>Текст <strong>заметки</strong>.</p>' in html
    assert '<div class="callout todo"><b class="tag">Нет в сценарии</b>' in html
    assert '<div class="note"><span class="who">Салфетка</span><p>Строка один<br />\nСтрока два</p>' in html
    assert ('<article class="quest"><header><h4>Касса</h4></header><div class="qbody">'
            '<div class="callout"><b class="tag">Вложенная</b>') in html
    assert '<p class="lede">Вступление.</p>' in html
    assert '<b class="tag">странное Что-то</b>' in html, "unknown blocks are shown, not lost"


def test_spec_choice_steps_diary_posters():
    src = """::: характеристики
Заказ: Бургер без булки
Просьба: «Найдите моё лицо»
  - протереть зеркало
  - найти салфетку
:::

::: выбор
- Да.
- (+) Да, но с пониманием.
- (-) Нет.
:::

::: этапы
#### Начало
Текст.
#### Погоня
> **Клоун:** Беги.
:::

::: дневник
#### Согласие
Открывается позже.
:::

::: плакаты
- Улыбнись!
:::"""
    html = render_markdown(src)
    assert "<dt>Заказ</dt><dd>Бургер без булки</dd>" in html
    assert "<dt>Просьба</dt><dd><p>«Найдите моё лицо»</p>\n<ul>\n<li>протереть зеркало</li>" in html
    assert '<ul class="choice"><li>Да.</li><li class="ok">Да, но с пониманием.</li><li class="bad">Нет.</li></ul>' in html
    assert '<ol class="steps"><li><h4>Начало</h4><p>Текст.</p>\n</li><li><h4>Погоня</h4><div class="line">' in html
    assert '<div class="diary"><article><h4>Согласие</h4><p>Открывается позже.</p>' in html
    assert '<ul class="posters">' in html


def test_images_tables_mermaid_and_fences():
    src = """![Кухня](/media/a.jpg "Кухня ночью")
![Зал](/media/b.jpg)

| Флаг | Тип |
| --- | --- |
| `x` | int |

```mermaid
A --> B
```

```
::: не блок
```"""
    html = render_markdown(src)
    assert ('<div class="gallery"><figure><img src="/media/a.jpg" alt="Кухня" loading="lazy">'
            "<figcaption>Кухня ночью</figcaption></figure><figure><img src=\"/media/b.jpg\"") in html
    assert '<div class="tbl-wrap"><table>' in html and '<td><span class="flag">x</span></td>' in html
    assert '<pre class="mermaid">A --&gt; B\n</pre>' in html
    assert "::: не блок" in html, "containers are not parsed inside code"


def test_unclosed_container_and_parse_tree():
    blocks = parse_blocks("до\n::: заметка А\nвнутри")
    assert blocks[0] == "до" and blocks[1].name == "заметка" and blocks[1].children == ["внутри"]


def test_render_scenario_sanitizes_raw_html():
    html = render_scenario('<div class="track" onclick="x()"><a href="javascript:1">a</a></div>')
    assert "onclick" not in html and "javascript" not in html and 'class="track"' in html


def test_html_to_markdown_round_trip_of_rare_parts():
    html = ('<div class="track"><a class="done" href="#ff">Сон 1</a>\n\n</div>'
            '<p>текст со *звёздочкой* и <i>курсивом</i><br/>перенос</p>'
            '<table><tr><td colspan="2">x</td></tr></table>'
            '<ol><li>раз<ul><li>вложенный</li></ul></li></ol>'
            '<div data-task="FF-V01"></div>')
    md = html_to_markdown(html)
    assert md.startswith('<div class="track"><a class="done" href="#ff">Сон 1</a>\n</div>'), "kept as HTML"
    assert "текст со \\*звёздочкой\\* и *курсивом*\\\nперенос" in md
    assert '<table><tr><td colspan="2">x</td></tr></table>' in md
    assert "1. раз\n   - вложенный" in md
    back = sanitize_html(render_markdown(md))
    assert "звёздочкой" in back and "<em>курсивом</em>" in back and 'colspan="2"' in back
