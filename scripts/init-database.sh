#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${APP_DATABASE_PASSWORD:?}"
# The image's POSTGRES_USER is an administrator. Rails only receives this
# separate restricted role; PostGIS installation remains an admin operation.
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
 --set app_password="$APP_DATABASE_PASSWORD" --set app_database="$POSTGRES_DB" <<'SQL'
SELECT 'CREATE ROLE geolab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geolab_app')\gexec
ALTER ROLE geolab_app WITH PASSWORD :'app_password';
ALTER DATABASE :"app_database" OWNER TO geolab_app;
GRANT USAGE, CREATE ON SCHEMA public TO geolab_app;
CREATE EXTENSION IF NOT EXISTS postgis;
-- Also supports upgrading an existing volume whose Rails tables were created
-- by the old administrator connection. Extension-owned objects stay with admin.
SELECT format('ALTER %s %I.%I OWNER TO geolab_app',
 CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
 WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
   AND d.objid = c.oid AND d.deptype = 'e')
ORDER BY CASE WHEN c.relkind = 'S' THEN 1 ELSE 0 END\gexec
SQL
