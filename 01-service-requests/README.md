# Civic Works: service-request manager

A functional Rails, React, PostgreSQL/PostGIS training application for mapped service requests. Data is synthetic and centered near Lewisville, Texas. This application is a learning implementation, not a connection to municipal systems.

## Run

From this folder, generate unique session and database secrets, then start the stack. Seeding explicitly creates the demo accounts:

```sh
node ../scripts/configure-env.mjs
docker compose up --build -d
docker compose exec api bundle exec rails db:seed
```

Open `http://localhost:5171`. The Compose stack includes PostgreSQL with PostGIS, Redis, the Rails API, a background worker, and the built frontend. The frontend build uses shared components from the repository root, so keep this folder within the repository. See the root README for the native development workflow and deployment configuration.

Demo accounts use password `Learning123!`:

| Email | Role | Access |
| --- | --- | --- |
| `staff@example.test` | Staff | All requests, assignment, imports, reports |
| `crew@example.test` | Staff | Second staff session for concurrent-update testing |
| `reporter@example.test` | Reporter | Create requests and read only their own requests |

## Implemented workflow

1. Sign in as the reporter and create an issue with a category and WGS 84 coordinates.
2. Sign in as staff in another browser session. Requests appear on the ArcGIS map and linked register. Search text, category, status, and a distance filter work together.
3. Select a request and assign staff. Status follows `new → assigned → in_progress → resolved`; resolved work can reopen to `in_progress` and work in progress can return to `assigned`.
4. Changes broadcast over Action Cable to staff and the original reporter. A 15-second refresh and reconnect refresh recover missed events. Reporter channels never subscribe to the staff stream.
5. Use Imports & reports to download the sample GeoJSON, import it, inspect row errors/progress, and generate a CSV export in the background.

The map/register displays at most the latest 500 matching requests. Summary counts include every matching request; the interface explicitly reports truncation. CSV exports include all requests visible to the exporting staff member, regardless of map filters.

## Engineering details

- `Issue` enforces category, coordinates, staff-only assignments, and status transitions. PostgreSQL stores a generated `geography(Point,4326)` column with a GiST index; `ST_DWithin` filters in meters.
- Staff edits require `lock_version`. Stale writes return HTTP 409, and the UI requires current values to be reviewed before another save.
- Import requests accept a GeoJSON FeatureCollection with 1 to 500 Point features and a payload smaller than 2 MB. Properties require `title`; `category` defaults to `roads`; `description` is optional.
- A per-user SHA-256 digest reuses identical imports. Each feature has a unique stable source key. PostgreSQL advisory locks serialize executions of the same import, and retrying after partial work does not duplicate issues.
- Validation errors reject individual rows while valid rows continue. Unexpected failures mark the run failed; Active Job makes up to three attempts in total (Sidekiq's own retries are disabled), and the interface exposes **Retry import** for a run that stays failed. Corrected validation errors require a new upload.
- CSV exports run as jobs, store downloadable output in the database, and neutralize spreadsheet formula prefixes in free text. Only the staff member who requested a report can download it.
- Background report storage is appropriate for this bounded demo. Large production exports would use object storage, retention policies, and snapshot semantics.

## API

All `/api` domain endpoints require the cookie session. Writes require the CSRF token exposed by `GET /api/session`; the shared `api` helper supplies it.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/issues` | Visible issues, filtered counts; accepts `q`, `status`, `category`, `latitude`, `longitude`, `radius_m` |
| GET | `/api/issues/:id` | Visible issue details |
| POST | `/api/issues` | `{issue:{title,description,category,latitude,longitude}}` |
| PATCH | `/api/issues/:id` | Staff edit with `{issue:{assigned_to_id,status,lock_version}}` |
| GET | `/api/staff` | Assignable staff; staff only |
| GET/POST | `/api/import_runs` | List owned runs / queue `{geojson:FeatureCollection}` |
| POST | `/api/import_runs/:id/retry` | Retry an owned failed import |
| GET/POST | `/api/export_runs` | List owned reports / queue a full CSV |
| GET | `/api/export_runs/:id/download` | Download an owned completed CSV |

Channel: `RequestUpdatesChannel`, with server-selected streams. Clients cannot choose a different user's stream.

## Verification

Run `RAILS_ENV=test bundle exec rails runner 'ActiveRecord::Base.connection_pool.schema_migration.create_table'`, then `RAILS_ENV=test bundle exec rails db:migrate`, then `bundle exec rails test test/domain_test.rb` in the backend environment after preparing the test database with the PostGIS extension. Tests cover invalid coordinates, permitted lifecycle transitions, staff assignment validation, spatial filtering and generated-point updates, import row rejection and replay, formula-safe CSV generation, anonymous access, reporter ownership, forbidden writes, stale-write conflicts, import deduplication, report ownership, and private channel subscriptions.

From the repository root, run `npm exec vitest run tests/service-requests.test.jsx` for React tests covering mapped selection and assignment, stale draft protection, and reporter access to interface controls. Real browser tests for the service lifecycle, WebSocket delivery to another user, background imports/reports, and fleet replay are in `tests/browser/service-fleet.spec.js`.

Manual browser check: open separate staff/reporter sessions; create a reporter issue; assign and advance it as staff; confirm the reporter sees each change without refreshing. Open the same issue in both staff accounts and confirm a stale draft cannot overwrite newer data. Import the sample twice and confirm the second submission reuses the existing run.
