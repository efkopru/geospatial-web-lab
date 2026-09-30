#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
source "$root/scripts/runtime-common.sh"
status=0
for file in .runtime/*-api.pid .runtime/*-worker.pid; do
 [ -f "$file" ] || continue
 name="$(basename "$file" .pid)"
 kind="${name##*-}"
 project="${name%-$kind}"
 case "$project" in
  01-service-requests|02-data-quality-portal|03-fleet-monitor|04-parcel-scenarios|05-infrastructure-inspections) ;;
  *) continue ;;
 esac
 pid="$(cat "$file" 2>/dev/null || true)"
 if runtime_stop "$pid" "$root/$project/backend" "$kind"; then rm -f "$file"; else status=1; fi
done
exit "$status"
