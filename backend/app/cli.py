"""Maintenance commands.

    python -m app.cli create-admin <username> <password>
    python -m app.cli set-role <username> <viewer|editor|admin>
    python -m app.cli reseed            # wipe sections/tasks and re-import seed_data/scenario.json
"""
import sys

from sqlalchemy import delete, func, select

from .config import get_settings
from .db import Database
from .models import Revision, Role, Section, Task, User
from .seed import ensure_admin, load_seed, seed_scenario


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    database = Database(get_settings().database_url)
    database.create_all()
    db = database.SessionLocal()
    try:
        cmd, *args = argv
        if cmd == "create-admin" and len(args) == 2:
            user = ensure_admin(db, *args)
            user.role = Role.admin
            db.commit()
            print(f"admin: {user.username}")
        elif cmd == "set-role" and len(args) == 2:
            user = db.scalar(select(User).where(func.lower(User.username) == args[0].lower()))
            if user is None:
                print("user not found")
                return 1
            user.role = Role(args[1])
            db.commit()
            print(f"{user.username}: {user.role.value}")
        elif cmd == "reseed" and not args:
            db.execute(delete(Revision))
            db.execute(delete(Task))
            db.execute(delete(Section))
            db.commit()
            seed_scenario(db, load_seed())
            print("reseeded")
        else:
            print(__doc__)
            return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
