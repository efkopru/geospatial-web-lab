# Geospatial data-quality portal

A Rails, React, PostgreSQL/PostGIS learning application that turns GeoJSON uploads into reviewed, immutable publication snapshots. Background validation has durable progress, record-level findings, retry-safe writes, and live updates through Action Cable. All bundled data is synthetic.

## Run

Run from this folder with Docker Desktop running:

```powershell
node ../scripts/configure-env.mjs
# Generate unique session and database secrets; preserve existing values.
docker compose up --build -d
docker compose exec api bundle exec rails db:seed
```

Open http://localhost:5172. Sign in as `staff@example.test` or `reporter@example.test`, password `Learning123!`. The seed creates one approved clean inventory and one dataset with deliberate errors. These accounts are for local learning. Replace them and configure HTTPS, secure cookies, secrets, backups, and host/origin allowlists before hosting a public instance.

The root workspace README covers prerequisites, combined frontend builds, environment configuration, and each application's port. The container database is PostgreSQL 17 with PostGIS; Redis serves the Sidekiq queue and Action Cable. Seeds run validation synchronously. Notification delivery failures are logged without invalidating committed processing; the client also polls authoritative state.

## Exercise the workflow

1. Sign in as the reporter and inspect **Parks With Errors**. Four rejected features demonstrate a missing identifier, a self-intersecting polygon, reversed coordinates, and an unclosed ring.
2. Open **Upload GeoJSON** and choose `backend/samples/parks-clean.geojson` or your own synthetic FeatureCollection. Specify required attribute keys. Re-uploading equivalent JSON with the same rules opens the existing dataset.
3. Watch queued, validating, and ready states. Inspect each record's findings and source JSON. Only accepted features appear on the ArcGIS map. A five-second refresh recovers missed cable events.
4. Sign in as staff. Approve the valid records. For mixed datasets, explicitly acknowledge the rejected records that will be excluded. A dataset with no accepted features cannot be approved.
5. Download the approved GeoJSON. The version records the reviewer, feature count, timestamp, and SHA-256 digest. Both model protection and a database trigger prevent updates or deletion of published versions.
6. Correct an erroneous source file and upload it as a new dataset. Earlier sources and approved versions remain available for comparison.

## Contract and validation rules

- Input is a GeoJSON `FeatureCollection`, 1 to 2,000 features, maximum 5 MB. Upload uses a JSON request with a `source` string, rather than multipart form storage.
- Accepted geometry types: Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon. GeometryCollection, null geometry, empty components, and 3D positions are rejected explicitly.
- Coordinates must be exactly two finite numbers in longitude, latitude order, using WGS84/EPSG:4326. Longitude must be in [-180, 180], latitude in [-90, 90]. Polygon rings must close and contain at least four positions.
- PostGIS parses each structurally valid geometry and runs `ST_IsValid`; topology errors such as self-intersection produce record-level findings. A database CHECK constraint prevents accepted records with absent or invalid geometry. No automatic repair or coordinate-system guessing occurs.
- Required attributes are configurable, default `asset_id`. They must exist and be nonblank. Uniqueness and value-type rules are intentionally not assumed for these attributes.
- Reporters see their own datasets. Staff see and approve all datasets. Every API route enforces session authentication; approval enforces staff permissions on the server.
- Source content plus sorted validation rules determines the per-user import fingerprint. Jobs use a PostgreSQL advisory lock and unique `(dataset_id, ordinal)` records, so duplicate delivery and a retry cannot multiply imported rows. Worker failures leave a visible failed state and a **Retry validation** action. Active Job makes up to three attempts only for `ActiveRecord::ConnectionNotEstablished`; Sidekiq's own retries are disabled, so other failures wait for that action.
- Validation progress is committed every 10 records and at completion. All record writes commit individually, allowing the UI to observe processing while a job holds its advisory lock.
- Approval locks the dataset row, creates a single version, and changes status atomically. Repeated approval returns the existing version. Approved exports use the immutable snapshot, never a live query over mutable record rows.

## API

All paths below start with `/api`. Mutation requests require the session CSRF token supplied by `/session`.

| Method | Path | Result |
|---|---|---|
| GET | `/datasets` | Up to 100 accessible dataset summaries, newest first |
| POST | `/datasets` | Upload `{name, source, required_attributes}` and queue validation |
| GET | `/datasets/:id` | Progress, record errors, accepted map preview, version metadata |
| POST | `/datasets/:id/retry` | Queue a failed dataset again |
| POST | `/datasets/:id/approve` | Staff approval; `{acknowledge_rejected: true}` required when excluding rejects |
| GET | `/datasets/:id/export` | Approved GeoJSON attachment plus `X-Content-SHA256` header |

`DatasetChannel` delivers progress notifications scoped to the uploader and staff. The client reloads authoritative API state when notified.

## Tests

Use the separate test database provisioned by the root README/bootstrap workflow. From the workspace root in Linux/WSL, run:

```sh
bash scripts/test-backends.sh
```

The runtime Compose stack intentionally grants Rails no database-creation privileges and does not provision test databases. Tests cover malformed inputs, source limits, canonical upload deduplication, all six supported geometry types, invalid coordinate and polygon cases, partial-job retry, idempotent delivery, approval permissions/state, immutable versions, reporter isolation, and exported content/digest.

With the application and worker running and root npm dependencies installed, run the real browser workflow from the workspace root:

```powershell
node 02-data-quality-portal/frontend/tests/e2e.mjs
```

Install the Playwright Chromium runtime with `npx playwright install chromium` if needed. This check uploads a unique synthetic mixed dataset as the reporter, reviews errors, approves its valid features in a separate staff session, verifies the live approval notification, and downloads the immutable export. It leaves its synthetic approved dataset in the database and saves a screenshot under `frontend/test-results`.

## Engineering study points

Read `Dataset.import!` for content-addressed deduplication, `GeojsonValidator` for input contracts, `ValidateDatasetJob` for retry-safe background work, and `Dataset#approve!` for transaction boundaries. The migration demonstrates JSONB, spatial indexing, check constraints, and a publication-immutability trigger. The React interface coordinates file input, live progress, map selection, filtering, and explicit publication decisions.

This is a deliberately bounded single-file import workflow. Files and review results live in PostgreSQL, and each detail request returns at most 2,000 records. Large production ingestion would need object storage, streaming parsing, paginated record review, retention controls, and queue observability before increasing those limits.
