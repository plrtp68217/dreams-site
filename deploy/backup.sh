#!/bin/sh
# Backup of the database and images into ./backups/dreams-<date>.tar.gz (run from the project folder).
# Cron, every night at 04:00:  0 4 * * * cd /opt/dreams && ./deploy/backup.sh >> backups/backup.log 2>&1
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)

# consistent copy of the SQLite file while the app keeps running
docker compose exec -T backend python -c "
import sqlite3
src = sqlite3.connect('/data/dreams.db')
dst = sqlite3.connect('/data/backup.db')
src.backup(dst)
dst.close()
"
docker run --rm -v dreams_dreams-data:/data:ro -v "$PWD/backups:/backups" alpine \
  tar czf "/backups/dreams-$stamp.tar.gz" -C /data backup.db media
docker compose exec -T backend rm -f /data/backup.db

# keep the last 14
ls -1t backups/dreams-*.tar.gz | tail -n +15 | xargs -r rm --
echo "$(date '+%F %T') backups/dreams-$stamp.tar.gz"
