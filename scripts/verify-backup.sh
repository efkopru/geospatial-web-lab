#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime
export PGPASSWORD=geolab
target="geolab_restore_check_$(date +%s)"
pg_dump -h 127.0.0.1 -U geolab -d service_requests --no-owner --no-acl --exclude-table-data=public.spatial_ref_sys -Fc -f .runtime/service-requests.dump
createdb -h 127.0.0.1 -U geolab "$target"
trap 'dropdb -h 127.0.0.1 -U geolab --if-exists "$target"' EXIT
su postgres -c "psql -d $target -c 'CREATE EXTENSION IF NOT EXISTS postgis'" >/dev/null
pg_restore -h 127.0.0.1 -U geolab -d "$target" --no-owner --no-acl --no-comments .runtime/service-requests.dump
source_count="$(psql -h 127.0.0.1 -U geolab -d service_requests -tAc 'SELECT count(*) FROM issues')"
restored_count="$(psql -h 127.0.0.1 -U geolab -d "$target" -tAc 'SELECT count(*) FROM issues')"
test "$source_count" = "$restored_count"
psql -h 127.0.0.1 -U geolab -d "$target" -tAc 'SELECT count(*) FROM issues WHERE ST_IsValid(location::geometry)'
printf 'Backup restored into %s; issue count %s matches source.\n' "$target" "$restored_count"
# Remove only the throwaway database this invocation created.
dropdb -h 127.0.0.1 -U geolab "$target"
trap - EXIT
