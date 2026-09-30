#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
for project in 0*/backend; do
 printf '\nTesting %s\n' "$project"
 cd "$root/$project"
 RAILS_ENV=test bundle exec rails runner 'ActiveRecord::Base.connection_pool.schema_migration.create_table'
 RAILS_ENV=test bundle exec rails db:migrate
 RAILS_ENV=test bundle exec rails test
 cd "$root"
done
