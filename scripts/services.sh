#!/usr/bin/env bash
# Start, stop or check Postgres + Redis for local development.
#
# Uses `docker compose` (docker-compose.yml) when Docker is available.
# Without Docker, it runs real Postgres 16 and Redis 6.2 binaries that ship in
# the `pgserver` and `redislite` pip packages, installed into .tools/ and
# storing data in .data/. Both modes listen on the same ports with the same
# credentials, so .env works unchanged.
#
#   scripts/services.sh start|stop|status
#   SERVICES_MODE=local scripts/services.sh start   # force the no-Docker mode
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="${1:-start}"
PG_PORT="${PG_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
PG_USER=freight
PG_PASSWORD=freight
PG_DB=freight

if [[ "${SERVICES_MODE:-auto}" != "local" ]] && command -v docker >/dev/null 2>&1 \
   && docker compose version >/dev/null 2>&1; then
  cd "$ROOT"
  case "$CMD" in
    start) docker compose up -d --wait ;;
    stop) docker compose stop ;;
    status) docker compose ps ;;
    *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
  esac
  exit 0
fi

TOOLS="$ROOT/.tools"
DATA="$ROOT/.data"
VENV="$TOOLS/venv"

ensure_tools() {
  if [[ ! -x "$VENV/bin/python" ]]; then
    echo "Docker not found: installing Postgres and Redis binaries into .tools/ (one time)…"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q pgserver==0.1.4 redislite==6.2.912183
  fi
  SITE="$("$VENV/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
  PGBIN="$SITE/pgserver/pginstall/bin"
  REDIS_BIN="$SITE/redislite/bin"
}

pg_running() { "$PGBIN/pg_ctl" -D "$DATA/pg" status >/dev/null 2>&1; }
redis_running() { "$REDIS_BIN/redis-cli" -p "$REDIS_PORT" ping >/dev/null 2>&1; }

start() {
  ensure_tools
  mkdir -p "$DATA/pgsock"
  if [[ ! -f "$DATA/pg/PG_VERSION" ]]; then
    local pwfile; pwfile="$(mktemp)"; echo "$PG_PASSWORD" >"$pwfile"
    "$PGBIN/initdb" -D "$DATA/pg" -U "$PG_USER" --pwfile="$pwfile" \
      --auth-host=scram-sha-256 --auth-local=trust -E UTF8 >/dev/null
    rm -f "$pwfile"
  fi
  if pg_running; then
    echo "postgres: already running on port $PG_PORT"
  else
    "$PGBIN/pg_ctl" -D "$DATA/pg" -l "$DATA/postgres.log" -w \
      -o "-p $PG_PORT -h 127.0.0.1 -k $DATA/pgsock" start >/dev/null
    echo "postgres: started on port $PG_PORT"
  fi
  if ! "$PGBIN/psql" -h "$DATA/pgsock" -p "$PG_PORT" -U "$PG_USER" -d postgres -tAc \
       "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" | grep -q 1; then
    "$PGBIN/createdb" -h "$DATA/pgsock" -p "$PG_PORT" -U "$PG_USER" "$PG_DB"
  fi
  if redis_running; then
    echo "redis: already running on port $REDIS_PORT"
  else
    "$REDIS_BIN/redis-server" --port "$REDIS_PORT" --bind 127.0.0.1 --daemonize yes \
      --dir "$DATA" --pidfile "$DATA/redis.pid" --logfile "$DATA/redis.log" \
      --save "" --appendonly no
    for _ in $(seq 20); do redis_running && break; sleep 0.1; done
    echo "redis: started on port $REDIS_PORT"
  fi
}

stop() {
  ensure_tools
  if pg_running; then "$PGBIN/pg_ctl" -D "$DATA/pg" -m fast stop >/dev/null; echo "postgres: stopped"; fi
  if redis_running; then "$REDIS_BIN/redis-cli" -p "$REDIS_PORT" shutdown nosave >/dev/null || true; echo "redis: stopped"; fi
}

status() {
  ensure_tools
  pg_running && echo "postgres: running on port $PG_PORT" || echo "postgres: stopped"
  redis_running && echo "redis: running on port $REDIS_PORT" || echo "redis: stopped"
}

case "$CMD" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
