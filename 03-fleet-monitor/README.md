# Fleet and geofence monitor

Rails, React, PostGIS, Sidekiq, Redis, and Action Cable application for exploring fleet telemetry using **synthetic data only**. Ten seeded vehicles follow looping routes around a fictional Dallas operations area. The UI always labels this as a simulation.

## Implemented workflows

- Staff starts, pauses, resets, and changes the replay multiplier. Reset clears positions, recorded trails, and transition history while preserving routes and geofences.
- A Sidekiq job advances persisted replay state and all vehicles. Every intermediate route point is processed at higher speeds, so acceleration does not skip geofence transitions.
- Action Cable broadcasts state invalidations to every signed-in browser. The frontend reloads current state on connection/reconnection and has a five-second polling fallback.
- Selecting a vehicle in the list or map shows its planned route, recent recorded trail, latest position, sequence, speed chart, and zone membership.
- PostGIS `ST_Covers` treats polygon boundaries as inside. One entry/exit event is recorded per membership transition; repeated positions do not create repeated events.
- Staff adds rectangular geofences in the UI. The API also accepts arbitrary valid closed polygon rings. Invalid, intersecting, degenerate, or out-of-range polygons are rejected.
- Manual telemetry is accepted through the API while replay is paused. Duplicate and out-of-order sequence numbers are ignored without mutating current state. Resumed replay continues above the accepted sequence.
- Observer accounts can inspect fleet data, but Rails enforces staff permissions for replay, manual telemetry, and zone modifications.

## Run

From the repository root, follow the root README prerequisites and setup. From this folder:

```powershell
node ../scripts/configure-env.mjs
# Generate unique session and database secrets; preserve existing values.
docker compose up --build -d
docker compose exec api bundle exec rails db:seed
```

Open `http://localhost:5173`. Demo staff: `staff@example.test`; observer: `reporter@example.test`; both passwords: `Learning123!`. Start the replay as staff. A second browser session will receive updates automatically. Seed users are for a local learning environment; change credentials before external deployment.

The PostgreSQL and Redis services use persistent volumes. `docker compose down` preserves the dataset; `docker compose down -v` deletes it. The root scripts also support a local development workflow.

## API

All domain routes require a session. Send the session CSRF token as `X-CSRF-Token` for mutations.

| Endpoint | Purpose | Access |
| --- | --- | --- |
| `GET /api/fleet` | Current control state, vehicles, zones, newest 100 events | Signed in |
| `POST /api/fleet/control` | `{action_name: "start" \| "pause" \| "reset" \| "speed", speed: 1 \| 2 \| 4}` | Staff |
| `GET /api/vehicles/:id/history` | Vehicle details, planned route, newest 360 recorded points | Signed in |
| `POST /api/vehicles/:id/telemetry` | `{sequence, longitude, latitude, speed_kph}`; paused replay only | Staff |
| `POST /api/geofences` | `{geofence: {name, color, coordinates: [[longitude,latitude], …]}}` | Staff |
| `DELETE /api/geofences/:id` | Removes zone and associated memberships/events | Staff |
| `/cable`, `ReplayChannel` | `fleet.updated` invalidation events | Signed in |
| `GET /up` | Health check | Public |

Session routes: `GET`, `POST`, and `DELETE /api/session`.

## Data and correctness

The replay controller is a database singleton protected by a row lock. Generation changes invalidate old jobs after pause/reset. Each job carries the expected cursor; a duplicate job cannot advance the same frame twice or fork another replay chain. Enqueue failures roll back the replay transaction. Queued next frames are persisted in Redis. Unexpected loss of an executing process may require pausing and starting replay to establish a new generation; this learning app does not claim exactly-once delivery across PostgreSQL and Redis.

Telemetry updates acquire the same controller lock at the API/replay boundary and a vehicle lock while recording. `last_sequence` is the ordering authority. Timestamps are server receipt times. Position geometry is stored in EPSG:4326 with GiST indexes. Coordinates use longitude first. History is bounded to 360 points per vehicle and 500 transition events globally. These are explicit demo retention limits, not an archival telemetry design. Zones added during a running replay are evaluated on the next accepted fix. Zone deletion removes its event history.

The requested multiplier is the number of frames processed per job, with ten simulated seconds per frame. Jobs request a one-second delay. Sidekiq scheduling and host load determine actual wall-clock cadence. Speeds come from geography distance between synthetic route points; no real street routing or GPS accuracy is implied.

## Tests

With dependencies installed and a separate test database available:

```sh
cd backend
RAILS_ENV=test bundle exec rails runner 'ActiveRecord::Base.connection_pool.schema_migration.create_table'
RAILS_ENV=test bundle exec rails db:migrate
RAILS_ENV=test TEST_DATABASE_URL=postgres://geolab:geolab@localhost:5432/fleet_monitor_test bundle exec rails test
```

The suite covers boundary inclusion, initial entry, repeated fixes, duplicate and out-of-order rejection, invalid input, geometry SRID, bounded history, polygon validity, idempotent start/duplicate jobs, stale generations, reset, accelerated intermediate frames, observer permissions, manual telemetry conflicts, and geofence API lifecycle. Build the frontend from the repository root with `npm run build --workspace=@geo/fleet-monitor`.

## Learning areas

Trace a position from `ReplayControlJob` through `ReplayEngine`, `TelemetryRecorder`, PostGIS membership evaluation, Action Cable, and React state refresh. Extend the API with an authenticated device-ingestion adapter, add fleet-specific zone rules, or compare spatial query plans using the provided GiST indexes. Keep any real telemetry ingestion separate from the clearly labelled simulation controls.
