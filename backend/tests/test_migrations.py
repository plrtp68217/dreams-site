from sqlalchemy import create_engine, inspect, text

from app.db import Database
from app.html_to_markdown import html_to_markdown
from app.scenario_cleanup import convert, readable_titles, short_name

OLD_SCHEMA = [
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(64), display_name VARCHAR(128), "
    "password_hash VARCHAR(128), role VARCHAR(6), is_active BOOLEAN, created_at DATETIME)",
    "CREATE TABLE sections (id INTEGER PRIMARY KEY, slug VARCHAR(80), title VARCHAR(200), \"group\" VARCHAR(9), "
    "parent_id INTEGER, position INTEGER, status VARCHAR(4), content TEXT, version INTEGER, updated_at DATETIME, "
    "updated_by_id INTEGER)",
    "CREATE TABLE tasks (id INTEGER PRIMARY KEY, code VARCHAR(40) UNIQUE, title VARCHAR(300), kind VARCHAR(8), "
    "section_id INTEGER, status VARCHAR(11), assignee_id INTEGER, content TEXT, position INTEGER, version INTEGER, "
    "updated_at DATETIME, updated_by_id INTEGER)",
    "CREATE TABLE revisions (id INTEGER PRIMARY KEY, entity_type VARCHAR(20), entity_id INTEGER, version INTEGER, "
    "title VARCHAR(300), content TEXT, author_id INTEGER, created_at DATETIME)",
]

SECTION = (
    '<p>Посетители <a href="#ff-visitors">FF-V01…V07</a>, см. FF-V01.</p>'
    '<div class="callout proposal"><b class="tag">Предложение</b><p>Наша идея</p></div>'
    '<div data-task="FF-V01"></div><div data-task="Q-01"></div>'
)
CARD = (
    '<div class="line" data-id="FF-V01-01"><span class="who">Мужчина<span class="lid">FF-V01-01</span></span>'
    "<q>Комбо</q></div>"
    '<div class="line" data-id="FF-V01-00"><span class="who">Мужчина (предложение)</span><q>Нет</q></div>'
    '<div class="note"><span class="who">Записка FF-NOTE-01</span>Текст</div>'
)


def old_database(path):
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    with engine.begin() as conn:
        for ddl in OLD_SCHEMA:
            conn.execute(text(ddl))
        conn.execute(text("INSERT INTO sections VALUES (1, 'ff-visitors', 'Посетители', 'levels', NULL, 0, 'done', "
                          ":c, 3, '2026-10-01 10:00:00', NULL)"), {"c": SECTION})
        conn.execute(text("INSERT INTO tasks VALUES (1, 'FF-V01', 'Мужчина без лица', 'quest', 1, 'todo', NULL, :c, "
                          "0, 1, '2026-10-01 10:00:00', NULL)"), {"c": CARD})
        conn.execute(text("INSERT INTO tasks VALUES (2, 'Q-01', 'FF-V01', 'question', NULL, 'todo', NULL, "
                          "'<p>Вопрос</p>', 1, 1, '2026-10-01 10:00:00', NULL)"))
        conn.execute(text("INSERT INTO revisions VALUES (1, 'task', 1, 1, 't', 'c', NULL, '2026-10-01 10:00:00')"))
    engine.dispose()


def test_upgrade_folds_tasks_into_sections(tmp_path):
    path = tmp_path / "dreams.db"
    old_database(path)
    database = Database(f"sqlite:///{path.as_posix()}")
    database.create_all()
    database.create_all()  # second run is a no-op

    assert "code" not in {c["name"] for c in inspect(database.engine).get_columns("tasks")}
    assert len(list(tmp_path.glob("dreams.before-tasks-v2-*.db"))) == 1
    assert len(list(tmp_path.glob("dreams.before-markdown-*.db"))) == 1
    with database.engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM tasks")).scalar() == 0
        content, source, version = conn.execute(text("SELECT content, source, version FROM sections")).one()
        revisions = conn.execute(text("SELECT entity_type, version, content FROM revisions")).all()
    database.engine.dispose()

    assert version == 4
    assert revisions == [("section", 3, html_to_markdown(SECTION))], "task history dropped, old text kept"
    assert "::: карточка Мужчина без лица" in source and "<" not in source
    assert "Предложение" not in content and "предложение" not in content
    assert '<article class="quest" data-id="ff-v01"' in content
    assert '<article class="quest" data-id="q-01"' in content
    assert ">Мужчина без лица</h4>" in content and ">Мужчина без лица</h4></header><div class=\"qbody\"><p>Вопрос" in content
    assert 'Посетители <a href="#ff-visitors" rel="noopener noreferrer">посетители</a>, см. ' in content
    assert '<a href="#ff-v01" rel="noopener noreferrer">Мужчина без лица</a>.' in content
    assert "lid" not in content and '<div class="line" data-id="FF-V01-01">' in content
    assert '<div class="note" data-id="FF-NOTE-01"><span class="who">Записка</span>' in content
    assert 'data-id="p-' in content, "new places get anchors"


def test_upgrade_skips_new_schema():
    database = Database("sqlite://")
    database.create_all()
    assert "anchor" in {c["name"] for c in inspect(database.engine).get_columns("tasks")}


def test_readable_names():
    assert short_name("Зал: «Протрите столы»") == "«Протрите столы»"
    assert short_name("Клоун — невозможный заказ") == "Клоун"
    assert short_name("Касса") == "Касса"
    tasks = [{"code": "FF-V06", "title": "Солдат-курьер"}, {"code": "FF-S03", "title": "Кухня: «Масло»"},
             {"code": "Q-11", "title": "FF-V06 / FF-S03"}]
    assert readable_titles(tasks)["Q-11"] == "Солдат-курьер / «Масло»"


def test_convert_without_tasks_and_unknown_placeholder():
    sections = [{"content": '<p>x</p><div data-task="GONE"></div>'}]
    convert(sections, [])
    assert sections[0]["content"] == "<p>x</p>"
