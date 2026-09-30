#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
service postgresql start
service redis-server start
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='geolab'\"" | grep -q 1; then
 su postgres -c "psql -c \"CREATE ROLE geolab LOGIN CREATEDB PASSWORD 'geolab'\""
fi
for db in service_requests data_quality_portal fleet_monitor parcel_scenarios infrastructure_inspections; do
 for suffix in '' _test; do
  name="$db$suffix"
  if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$name'\"" | grep -q 1; then
   su postgres -c "createdb -O geolab $name"
  fi
  su postgres -c "psql -d $name -c 'CREATE EXTENSION IF NOT EXISTS postgis'" >/dev/null
 done
done
for project in 0*/backend; do
 mkdir -p "$project/tmp/pids" "$project/log"
done
printf 'PostgreSQL/PostGIS and Redis ready.\n'
