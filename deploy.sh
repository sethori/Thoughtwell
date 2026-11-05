#!/usr/bin/env bash
# One-command update for the home server.
#   ./deploy.sh            pull the latest code, back up, migrate, restart
#   ./deploy.sh --no-pull  deploy the code already checked out
# Backups land in ./backups, and the last 14 are kept.
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || { echo "Missing .env. Copy .env.example to .env and fill it in."; exit 1; }
set -a; source .env; set +a

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [[ "${1:-}" != "--no-pull" ]]; then
  say "Pulling latest code"
  git pull --ff-only
fi

say "Building images"
docker compose build

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
if docker compose ps --status running db | grep -q db; then
  say "Backing up the database and attachments ($STAMP)"
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "backups/db-$STAMP.dump"
  docker run --rm -v "$(basename "$PWD")_assets:/data:ro" -v "$PWD/backups:/out" alpine \
    tar czf "/out/assets-$STAMP.tgz" -C /data . 2>/dev/null || echo "  (no attachments yet)"
  ls -1t backups/db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
  ls -1t backups/assets-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
else
  say "Database not running yet; skipping backup (first deploy)"
fi

say "Starting the database and running migrations"
docker compose up -d db
docker compose run --rm migrate

say "Restarting the app"
docker compose up -d api web

say "Waiting for the health check"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT:-8080}/api/health" >/dev/null 2>&1; then
    say "Deployed. The app is healthy on port ${WEB_PORT:-8080}."
    exit 0
  fi
  sleep 2
done

echo "The app did not become healthy. Check: docker compose logs api"
echo "To restore the backup taken just now:"
echo "  docker compose exec -T db pg_restore -U \$POSTGRES_USER -d \$POSTGRES_DB --clean < backups/db-$STAMP.dump"
exit 1
