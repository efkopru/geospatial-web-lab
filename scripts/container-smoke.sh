#!/usr/bin/env bash
# Builds one application's Compose stack, starts it with generated secrets, and checks
# migrations, the API, the frontend proxy, seeding and the Sidekiq worker inside containers.
# Usage: scripts/container-smoke.sh 02-data-quality-portal [--keep]
set -euo pipefail
cd "$(dirname "$0")/.."
project="${1:?Usage: scripts/container-smoke.sh <0N-project> [--keep]}"
keep="${2:-}"
[[ "$project" =~ ^0([1-5])-[a-z0-9-]+$ && -f "$project/compose.yaml" ]] || { echo "Unknown project: $project" >&2; exit 2; }
port=$((5170 + BASH_REMATCH[1]))
base="http://127.0.0.1:$port"
# A separate Compose project keeps the smoke stack's containers and volumes apart from a
# developer's own stack for the same app, which uses the compose file's fixed name.
compose=(docker compose -p "geolab-smoke-${project}" -f "$project/compose.yaml")

[[ -f "$project/.env" ]] || node scripts/configure-env.mjs >/dev/null

cleanup() {
 status=$?
 if [[ $status -ne 0 ]]; then
  echo "::group::$project container logs"
  "${compose[@]}" ps -a || true
  "${compose[@]}" logs --no-color --tail=200 || true
  echo "::endgroup::"
 fi
 [[ "$keep" == "--keep" ]] || "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
 exit $status
}
trap cleanup EXIT

step() { echo "==> $project: $*"; }
fail() { echo "FAIL $project: $*" >&2; exit 1; }
wait_for() {
 local description="$1" seconds="$2"; shift 2
 # Measure wall-clock time: a probe such as rails runner can take several seconds itself.
 local deadline=$((SECONDS + seconds))
 until "$@" >/dev/null 2>&1; do
  ((SECONDS < deadline)) || fail "timed out after $((seconds + SECONDS - deadline))s waiting for $description"
  sleep 3
 done
}

# The smoke stack publishes the app's usual port, so another stack for the app must be stopped first.
if curl -s -o /dev/null --max-time 2 "$base/"; then
 trap - EXIT
 echo "FAIL $project: $base is already in use. Stop the other stack for this app (docker compose down in $project) and retry." >&2
 exit 1
fi

step "building images"
"${compose[@]}" build --pull
step "starting database, Redis, migrations, API, worker and web"
"${compose[@]}" up -d

wait_for "the API health check" 240 bash -c "[[ \$(${compose[*]} ps api --format '{{.Health}}') == healthy ]]"
migrate_exit="$("${compose[@]}" ps -a migrate --format '{{.ExitCode}}')"
[[ "$migrate_exit" == 0 ]] || fail "migrations exited with $migrate_exit"
step "migrations completed as the restricted application role"

wait_for "the web proxy" 60 curl -fsS -o /dev/null "$base/"
# Capture responses before matching; grep -q closing a pipe early would fail under pipefail.
index="$(curl -fsS "$base/")"
[[ "$index" == *'<div id="root"'* ]] || fail "frontend index did not contain the app root"
script="$(grep -o 'assets/[^"]*\.js' <<<"$index" | head -1 || true)"
[[ -n "$script" ]] && curl -fsS -o /dev/null "$base/$script" || fail "frontend bundle ${script:-<none>} was not served"
[[ "$(curl -fsS "$base/up")" == *'"status":"ok"'* ]] || fail "/up through the web proxy did not report ok"
[[ "$(curl -fsS "$base/api/session")" == *'"csrf_token"'* ]] || fail "/api/session through the web proxy did not return a CSRF token"
step "frontend, /up and /api/session respond through nginx"

# Header names are compared in lower case.
index_headers="$(curl -fsS -D - -o /dev/null "$base/" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
[[ "$index_headers" == *'x-content-type-options: nosniff'* ]] || fail "the page is served without X-Content-Type-Options"
[[ "$index_headers" == *'x-frame-options: deny'* ]] || fail "the page is served without X-Frame-Options"
[[ "$index_headers" == *"content-security-policy: default-src 'self';"*"frame-ancestors 'none'"* ]] || fail "the page is served without its Content-Security-Policy"
[[ "$index_headers" == *'cache-control: no-cache'* ]] || fail "the page is cacheable, so a new deployment may not be picked up"
asset_headers="$(curl -fsS -D - -o /dev/null -H 'Accept-Encoding: gzip' "$base/$script" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
[[ "$asset_headers" == *'content-encoding: gzip'* ]] || fail "the frontend bundle is not compressed"
[[ "$asset_headers" == *'cache-control: max-age=31536000'* ]] || fail "the hashed frontend bundle is not cached long-term"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/assets/missing-file.js")" == 404 ]] || fail "a missing asset did not return 404"
step "nginx sends security headers, compresses and caches the bundle"

# Failed sign-ins are limited per client address. A client's own Forwarded header must not move
# them to other addresses, so the sixth wrong password for one email is refused. Five failures
# stay well below the limit for the address, so later sign-ins from this host are unaffected.
jar="$(mktemp)"
csrf="$(curl -fsS -c "$jar" "$base/api/session" | grep -o '"csrf_token":"[^"]*"' | cut -d'"' -f4)"
[[ -n "$csrf" ]] || fail "/api/session returned no CSRF token for the sign-in check"
codes=""
for attempt in 1 2 3 4 5 6; do
 codes+="$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" -c "$jar" -H "X-CSRF-Token: $csrf" -H 'Content-Type: application/json' \
  -H "Forwarded: for=203.0.113.$attempt" -d '{"email":"smoke-nobody@example.test","password":"wrong password"}' "$base/api/session") "
done
rm -f "$jar"
[[ "$codes" == "401 401 401 401 401 429 " ]] || fail "six failed sign-ins sent with Forwarded headers answered $codes, not five 401s and a 429"
step "a client's Forwarded header does not move its failed sign-ins to another address"

"${compose[@]}" exec -T api bundle exec rails db:seed >/dev/null || fail "db:seed failed in the API container"
step "seed data loaded inside the API container"

wait_for "a Sidekiq process registered in Redis" 90 "${compose[@]}" exec -T worker bundle exec rails runner 'require "sidekiq/api"; exit(Sidekiq::ProcessSet.new.size.positive? ? 0 : 1)'
for service in api worker web; do
 container="$("${compose[@]}" ps -q "$service")"
 restarts="$(docker inspect -f '{{.RestartCount}}' "$container")"
 state="$(docker inspect -f '{{.State.Status}}' "$container")"
 [[ "$state" == running && "$restarts" == 0 ]] || fail "$service is $state with $restarts restarts"
done
step "API, worker and web are running without restarts"
echo "PASS $project container smoke test"
