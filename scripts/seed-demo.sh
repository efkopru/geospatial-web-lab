#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
for project in 0*/backend; do
 cd "$root/$project"
 bundle exec rails runner 'ActiveRecord::Base.connection_pool.schema_migration.create_table'
 bundle exec rails db:migrate db:seed
 cd "$root"
done
printf 'Demo data and learning accounts are ready.\n'
