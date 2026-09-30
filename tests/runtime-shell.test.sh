#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
manager=''
unrelated=''
cleanup() {
 if [[ -n "$manager" ]]; then kill -TERM "$manager" 2>/dev/null || true; wait "$manager" 2>/dev/null || true; fi
 if [[ -n "$unrelated" ]]; then kill -TERM "$unrelated" 2>/dev/null || true; wait "$unrelated" 2>/dev/null || true; fi
 # Only this test-created, canonical temporary directory is removed.
 [[ "$fixture" == /tmp/tmp.* && -d "$fixture" ]] && rm -rf -- "$fixture"
}
trap cleanup EXIT
mkdir -p "$fixture/scripts" "$fixture/bin" "$fixture/.runtime"
cp "$root/scripts/"{start-backends,stop-backends,runtime-common}.sh "$fixture/scripts/"
source "$fixture/scripts/runtime-common.sh"
runtime_command_matches 'puma 7.2.1 (tcp://127.0.0.1:3101) [backend]' api
runtime_command_matches '/usr/bin/ruby3.2 /usr/local/bin/bundle exec rails server -p 3101' api
runtime_command_matches 'ruby bin/rails server -p 3101' api
runtime_command_matches 'sidekiq 7.3.9 backend [0 of 3 busy]' worker
runtime_command_matches '/usr/bin/ruby3.2 /usr/local/bin/bundle exec sidekiq -c 3' worker
runtime_command_matches 'ruby /usr/local/bin/sidekiq -c 3' worker
! runtime_command_matches 'bash -c puma-helper' api
! runtime_command_matches 'ruby unrelated.rb sidekiq' worker
for name in 01-service-requests 02-data-quality-portal 03-fleet-monitor 04-parcel-scenarios 05-infrastructure-inspections; do
 mkdir -p "$fixture/$name/backend/config"
 touch "$fixture/$name/backend/config/routes.rb"
done
cat > "$fixture/bin/bundle" <<'BUNDLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIXTURE/commands.log"
case "$*" in
 'exec rails server'*) exec -a puma sleep 300 ;;
 'exec sidekiq'*) exec -a sidekiq sleep 300 ;;
esac
BUNDLE
cat > "$fixture/bin/curl" <<'CURL'
#!/usr/bin/env bash
sleep 0.2
exit 0
CURL
chmod +x "$fixture/bin/"*
export FIXTURE="$fixture" PATH="$fixture/bin:$PATH"
bash "$fixture/scripts/start-backends.sh" > "$fixture/launcher.log" 2>&1 &
manager=$!
for ((attempt=0; attempt<100; attempt++)); do
 grep -q 'Applications are ready' "$fixture/launcher.log" && break
 kill -0 "$manager" || { cat "$fixture/launcher.log"; exit 1; }
 sleep 0.1
done
grep -q 'Applications are ready' "$fixture/launcher.log"
[[ "$(grep -c 'exec rails db:migrate' "$fixture/commands.log")" == 5 ]]
! grep -q 'db:seed\|db:prepare' "$fixture/commands.log"
# A second launch must not migrate or mutate anything while the supervisor runs.
before="$(wc -l < "$fixture/commands.log")"
if bash "$fixture/scripts/start-backends.sh" > /dev/null 2>&1; then exit 1; fi
[[ "$(wc -l < "$fixture/commands.log")" == "$before" ]]
mapfile -t children < <(cat "$fixture/.runtime/"*.pid)
kill -TERM "$manager"
wait "$manager" 2>/dev/null || true
manager=''
for pid in "${children[@]}"; do ! kill -0 "$pid" 2>/dev/null; done
# Stale/corrupt PID files must never signal a different process, PID 0, or PID 1.
for pid in "$$" 0 1 bad-pid; do
 printf '%s\n' "$pid" > "$fixture/.runtime/01-service-requests-worker.pid"
 bash "$fixture/scripts/stop-backends.sh"
done
# A command that merely mentions the service name is not an owned service,
# even when its working directory happens to be the same backend directory.
(cd "$fixture/01-service-requests/backend"; exec -a unrelated-sidekiq-observer sleep 300) &
unrelated=$!
sleep 0.1
printf '%s\n' "$unrelated" > "$fixture/.runtime/01-service-requests-worker.pid"
bash "$fixture/scripts/stop-backends.sh"
kill -0 "$unrelated" 2>/dev/null || { printf 'Stopped an unrelated process whose name contained sidekiq.\n' >&2; exit 1; }
printf 'Backend supervisor: seed-free startup, exclusive launch, shutdown cleanup, stale PID safety passed.\n'
