#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
for project in 0*/backend; do
 cd "$root/$project"
 export SECRET_KEY_BASE="$(ruby -rsecurerandom -e 'print SecureRandom.hex(64)')"
 RAILS_ENV=production bundle exec rails zeitwerk:check
 RAILS_ENV=production bundle exec rails runner 'raise "Database unavailable" unless ActiveRecord::Base.connection.select_value("SELECT 1") == 1; raise "Wrong queue adapter" unless ActiveJob::Base.queue_adapter.is_a?(ActiveJob::QueueAdapters::SidekiqAdapter); puts "Production boot and database verified"'
 cd "$root"
done
