# Parcel scenario explorer

Rails + React application for choosing synthetic parcels, saving development assumptions, comparing calculated scenarios, and exporting reproducible snapshots. Accounts own their scenarios independently.

## Run

From the workspace root: `npm ci`, then `npm run dev:4`. Rails listens on 3104, frontend on 5174. Start all Rails services with `bash scripts/start-backends.sh` from Ubuntu after the setup in the root README. Demo users: `staff@example.test` and `reporter@example.test`, password `Learning123!`.

For containers, run `node ../scripts/configure-env.mjs` to generate unique session and database secrets, then `docker compose up --build -d` in this folder. Database and Redis volumes retain data. Seed only local/demo deployments with `docker compose exec api bundle exec rails db:seed`.

## Workflow

1. Select individual parcels on the ArcGIS map or table, or select a district's visible parcels.
2. Set floors, building coverage, and typical unit area. Save the scenario.
3. A Sidekiq job calculates geodesic site area using PostGIS and broadcasts completion through Action Cable.
4. Compare up to four completed scenarios. Download each complete calculation with the original parcel geometry and assumptions.

Calculation: site square feet × coverage × floors = gross floor area. 80% of gross area is assumed residential. Units = floor(residential area / unit area). Open space is ground not covered by the building footprint. These synthetic planning examples are not regulatory, engineering, or financial determinations. Height limits only produce explicit warnings.

## API and tests

- `GET /api/parcels?district=...&bbox=west,south,east,north`
- `GET/POST /api/scenarios`, `GET/DELETE /api/scenarios/:id`
- `POST /api/scenarios/:id/recalculate`, `GET /api/scenarios/:id/export`
- `ScenarioChannel` streams only the authenticated user's changes.

Recalculation retries failed scenarios only. Completed snapshots remain unchanged; save a new scenario for another calculation or updated parcel inputs. Queued and processing scenarios also reject retries to prevent competing revisions.

`RAILS_ENV=test bundle exec rails db:migrate test` from backend tests area calculations, input boundaries, duplicate/stale jobs, authentication, scenario ownership, and invalid spatial filters. The root browser suite tests interactive selection, persistence, asynchronous calculation, comparison, and export.

## Learning focus

GeoJSON frontend/backend contracts, PostGIS geography area versus planar coordinates, GiST spatial filtering, async jobs with revision guards, immutable calculation snapshots, React map/table selection, and server-enforced record ownership.
