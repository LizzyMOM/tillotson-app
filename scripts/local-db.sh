#!/bin/sh
# Start the local development database (this workspace only) and rebuild it if asked.
PG=/usr/lib/postgresql/16/bin
psql -h localhost -U postgres -tAc "select 1" >/dev/null 2>&1 || { rm -f /home/claude/pgdata/postmaster.pid; su postgres -c "$PG/pg_ctl -D /home/claude/pgdata -l /home/claude/pgdata/log.txt -o '-p 5432 -k /tmp' start" >/dev/null; sleep 2; }
if [ "$1" = "reset" ]; then
  cd "$(dirname "$0")/.."
  psql -h localhost -U postgres -q -c "drop database if exists eventapp with (force);" -c "create database eventapp;"
  psql -h localhost -U postgres -d eventapp -v ON_ERROR_STOP=1 -q -f db/schema.sql -f db/functions.sql -f db/backup.sql -f db/calendar.sql -f db/seed-t4nc27.sql -f db/seed-calendar-2027.sql -f db/orders.sql -f db/seed-orders-dev.sql
  # local testing only: registration open now
  psql -h localhost -U postgres -d eventapp -q -c "update events set registration_opens_at = now() - interval '1 day' where slug='t4nc27';"
fi
psql -h localhost -U postgres -tAc "select 'db ok'"
