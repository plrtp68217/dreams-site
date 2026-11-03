from sqlalchemy import select

from app.db import Database
from app.fastfood_update import update_fastfood
from app.models import Revision, Section, Task
from app.seed import load_seed, seed_scenario


def test_current_notes_replace_old_scenario_once_and_preserve_tasks():
    database = Database("sqlite://")
    database.create_all()
    data = load_seed()
    with database.SessionLocal() as db:
        seed_scenario(db, data)
        visitors = db.scalar(select(Section).where(Section.slug == "ff-visitors"))
        visitors.source = "Старый сценарий"
        visitors.content = "<p>Старый сценарий</p>"
        task = Task(title="Сохранить задачу", section_id=visitors.id, anchor="ff-v03")
        db.add(task)
        db.commit()
        assert update_fastfood(db, data)
        assert "641" in visitors.source and "307" in visitors.source
        assert visitors.source.count("Сценарий на этапе разработки.") == 4
        assert "Проверку счастья" not in visitors.source
        assert 'data-id="ff-v03"' in visitors.content
        revision = db.scalar(select(Revision).where(Revision.entity_id == visitors.id))
        assert revision.content == "Старый сценарий"
        assert task.section_id == visitors.id and task.anchor == "ff-v03"
        visitors.source = "Новая правка редактора"
        db.commit()
        assert not update_fastfood(db, data)
        assert visitors.source == "Новая правка редактора"
