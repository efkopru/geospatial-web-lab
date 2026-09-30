#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
source "$root/scripts/runtime-common.sh"
mkdir -p .runtime
exec 9> .runtime/backend-manager.lock
flock -n 9 || { printf 'Backend supervisor is already running.\n' >&2; exit 1; }
declare -a started_pids=() started_backends=() started_kinds=() started_files=()
cleanup() {
 trap - EXIT INT TERM
 for i in "${!started_pids[@]}"; do
  if runtime_stop "${started_pids[$i]}" "${started_backends[$i]}" "${started_kinds[$i]}"; then
   [[ "$(cat "${started_files[$i]}" 2>/dev/null || true)" != "${started_pids[$i]}" ]] || rm -f "${started_files[$i]}"
  fi
 done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
remember_child() {
 local pid="$1" kind="$2" file="$3"
 echo "$pid" > "$file"
 started_pids+=("$pid"); started_backends+=("$PWD"); started_kinds+=("$kind"); started_files+=("$file")
}
for project in 0*/backend; do
 [ -f "$project/config/routes.rb" ] || continue
 name="$(basename "$(dirname "$project")")"
 number="${name:0:2}"
 port=$((3100 + 10#$number))
 cd "$root/$project"
 mkdir -p tmp/pids log
 api_file="$root/.runtime/$name-api.pid"
 worker_file="$root/.runtime/$name-worker.pid"
 api_pid="$(cat tmp/pids/server.pid 2>/dev/null || true)"
 if runtime_process_matches "$api_pid" "$PWD" api; then
  printf '%s API already running; migrations skipped.\n' "$name"
  echo "$api_pid" > "$api_file"
 else
  # db:prepare implicitly seeds a new database. Migrate explicitly instead.
  bundle exec rails runner 'ActiveRecord::Base.connection_pool.schema_migration.create_table'
  bundle exec rails db:migrate
  rm -f tmp/pids/server.pid
  bundle exec rails server -b 127.0.0.1 -p "$port" 9>&- > "$root/.runtime/$name-api.log" 2>&1 &
  remember_child "$!" api "$api_file"
 fi
 worker_pid="$(cat "$worker_file" 2>/dev/null || true)"
 if runtime_process_matches "$worker_pid" "$PWD" worker; then
  printf '%s worker already running.\n' "$name"
 else
  bundle exec sidekiq -c 3 9>&- > "$root/.runtime/$name-worker.log" 2>&1 &
  remember_child "$!" worker "$worker_file"
 fi
 ready=false
 for ((attempt = 0; attempt < 60; attempt++)); do
  if curl --fail --silent "http://127.0.0.1:$port/up" > /dev/null; then ready=true; break; fi
  sleep 1
 done
 "$ready" || { printf '%s API did not become healthy; inspect .runtime/%s-api.log.\n' "$name" "$name" >&2; exit 1; }
 worker_pid="$(cat "$worker_file")"
 runtime_process_matches "$worker_pid" "$PWD" worker || { printf '%s worker failed to start.\n' "$name" >&2; exit 1; }
 cd "$root"
done
if ((${#started_pids[@]} == 0)); then printf 'All applications were already running.\n'; exit 0; fi
printf 'Applications are ready. Keep this terminal open; Ctrl+C stops the processes started here.\n'
set +e
wait -n "${started_pids[@]}"
status=$?
set -e
printf 'An application process stopped. Stopping remaining children.\n' >&2
((status != 0)) || status=1
exit "$status"
