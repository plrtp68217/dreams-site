#!/bin/sh
set -e

if [ -z "$DREAMS_SECRET_KEY" ]; then
  echo "DREAMS_SECRET_KEY is not set (see .env.example)" >&2
  exit 1
fi

# legacy images: add the ones missing in the volume, never overwrite
mkdir -p "$DREAMS_MEDIA_DIR"
cp -n /app/seed-media/* "$DREAMS_MEDIA_DIR"/ 2>/dev/null || true

exec "$@"
