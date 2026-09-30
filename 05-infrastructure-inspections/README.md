# 3D infrastructure inspections

Full-stack Rails and React application for a synthetic foothills utility corridor, using CesiumJS, PostGIS, Sidekiq, Redis, and Action Cable. Eight poles, towers, and control cabinets have separate base elevations and structure heights. The seed data and all derived surfaces are synthetic.

## Implemented workflows

- Explore actual Cesium 3D cylinders, cross-arms, cabinets, markers, and a surface strip following synthetic asset base elevations. Pick a structure or select it in the register; focus the camera on that asset or the entire corridor.
- Compare base elevation, structure height, and top elevation. A visual exaggeration control scales vertical differences in the scene without modifying stored measurements. Labels retain real synthetic input dimensions.
- Report an observation with severity and notes. Rails assigns the signed-in author and records an initial audit event. Staff can resolve or reopen observations with meaningful notes; optimistic locking prevents stale edits from silently overwriting changes.
- Review the complete report/resolve/reopen chronology. Asset colors and counts reflect unresolved observations, with critical observations highlighted separately.
- Queue profile preprocessing from the UI, watch pending/processing/completed/failed states, retry failures, inspect the result chart and sample table, and download the completed profile as GeoJSON.
- Live Action Cable invalidation reloads asset and inspection data in other sessions. A polling fallback and reconnect refresh recover current state.

## Run

See the repository root README for prerequisites, local development, and deployment. The Docker workflow from this folder is:

```powershell
node ../scripts/configure-env.mjs
# Generate unique session and database secrets; preserve existing values.
docker compose up --build -d
docker compose exec api bundle exec rails db:seed
```

Open `http://localhost:5175`. Staff login: `staff@example.test`; field inspector login: `reporter@example.test`; both passwords: `Learning123!`. Demo credentials are for local learning. Use different credentials before external deployment.

The Vite configuration serves Cesium Workers, Assets, ThirdParty, and Widgets locally during development and copies them into the production build. It requires no Cesium ion account or token. A WebGL-capable browser is needed for the 3D scene. The registry and inspection forms remain usable when the renderer cannot initialize.

## Elevation semantics

The viewer uses `EllipsoidTerrainProvider`, with explicit synthetic base heights plotted above the WGS84 ellipsoid. The green corridor strip linearly joins those input heights. It is a visualization of the local synthetic surface, not a real DEM, survey, or clearance assessment. `top_elevation_m = ground_elevation_m + structure_height_m`.

The display multiplier scales structure height and elevation differences around the lowest corridor base. Values in the forms, labels, database, and exported profile remain at their original scale. The generated profile contains ten interpolated samples per segment plus its endpoint. PostGIS geography distance provides the horizontal stationing, and sample coordinates follow the same geodesic, including across the antimeridian. Elevations interpolate linearly between the asset bases. Processing snapshots all source asset values so an existing result remains reproducible if source data changes.

Live updates cannot retarget an open status-editing form. A changed observation disables the stale draft until the inspector cancels and opens a new form. Notification outages do not undo successful records or profile computations; polling recovers the persisted state. Rejected profile enqueues appear as failed runs that can be retried.

## API

All domain routes require a session. Include the session CSRF token as `X-CSRF-Token` on mutations.

| Endpoint | Purpose | Access |
| --- | --- | --- |
| `GET /api/assets` | Ordered asset registry with measurements and open counts | Signed in |
| `GET /api/assets/:id` | Asset and inspection history | Signed in |
| `POST /api/assets/:id/inspections` | `{inspection: {severity, notes, observed_at}}` | Signed in |
| `PATCH /api/inspections/:id` | `{inspection: {status: "open" or "resolved", resolution_notes, lock_version}}` | Staff |
| `GET /api/profile_runs` | Ten newest preprocessing runs | Signed in |
| `POST /api/profile_runs` | Snapshot assets and queue profile processing | Signed in |
| `GET /api/profile_runs/:id` | Job state, source snapshot, and samples | Signed in |
| `POST /api/profile_runs/:id/retry` | Retry a failed run with a new generation | Signed in |
| `GET /api/profile_runs/:id/download` | Completed synthetic GeoJSON profile | Signed in |
| `/cable`, `InspectionChannel` | `inspection.updated` and `profile.updated` invalidations | Signed in |

Session routes are `GET`, `POST`, and `DELETE /api/session`. `/up` checks service health.

## Tests and verification

From the repository root, `npm run build --workspace=@geo/infrastructure-inspections` compiles the React/Cesium application and copies its local runtime assets.

Run backend tests against the separate test database configured in `backend/config/database.yml`:

```sh
cd backend
RAILS_ENV=test bundle exec rails runner 'ActiveRecord::Base.connection_pool.schema_migration.create_table'
RAILS_ENV=test bundle exec rails db:migrate
RAILS_ENV=test bundle exec rails test
```

The suite covers 3D geometry altitude, top-elevation calculations, invalid inspection input, audit events, PostGIS corridor distances, interpolation endpoints, snapshot reproducibility, completed-job idempotency, failure state, stale generations, reporter/staff authorization, ownership spoofing, status history, stale browser edits, background queueing, downloads, and retry rules.

The implementation uses native SQL for PostGIS geometry columns and quotes inputs through Active Record. With the plain PostgreSQL adapter, geometry columns can produce an unknown-type warning; application payloads use validated numeric coordinates and PostGIS functions rather than deserializing the geometry string.
