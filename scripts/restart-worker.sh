#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
source "$root/scripts/runtime-common.sh"
case "${1:-}" in
 01-service-requests|02-data-quality-portal|03-fleet-monitor|04-parcel-scenarios|05-infrastructure-inspections) name="$1" ;;
 *) printf 'Pass an exact project folder name.\n' >&2; exit 1 ;;
esac
mkdir -p .runtime
exec 9> .runtime/backend-manager.lock
flock -n 9 || { printf 'Backend supervisor owns the workers. Stop and start backends to reload them together.\n' >&2; exit 1; }
file="$root/.runtime/$name-worker.pid"
backend="$root/$name/backend"
pid="$(cat "$file" 2>/dev/null || true)"
runtime_stop "$pid" "$backend" worker
cd "$backend"
bundle exec sidekiq -c 3 9>&- > "$root/.runtime/$name-worker.log" 2>&1 &
pid=$!
echo "$pid" > "$file"
cleanup() {
 trap - EXIT INT TERM
 if runtime_stop "$pid" "$backend" worker; then rm -f "$file"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait "$pid"
