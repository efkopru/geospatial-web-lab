# Verification record

Checked locally on 2026-09-29. These results describe the implemented applications and observed runtime, not a public deployment.

## Backend tests

| Project | Tests | Assertions | Result |
| --- | ---: | ---: | --- |
| Service requests | 25 | 182 | Passed |
| Data quality portal | 21 | 133 | Passed |
| Fleet monitor | 20 | 105 | Passed |
| Parcel scenarios | 18 | 101 | Passed |
| Infrastructure inspections | 25 | 169 | Passed |
| Total | 109 | 690 | No failures, errors, or skipped tests |

The complete backend run passed after the audit fixes. Regression coverage includes copied-cookie logout revocation, expiry, independent sessions, WebSocket authorization, notification outages, rejected enqueues, concurrent jobs, stale revisions, malformed payloads, and geodesic profile sampling. Runtime: Ruby 3.2.3, Rails 8.1.4, PostgreSQL 16/PostGIS 3.4, Redis 7, and Sidekiq 7.3.9 in Ubuntu 24.04 WSL. Sidekiq uses connection_pool 2.5.5 because 3.x is incompatible with the chosen Sidekiq scheduler.

## Frontend and browser evidence

- The second audit's complete Playwright run passed all 13 scenarios in 3.2 minutes.
- All 44 frontend tests passed across ten suites. Audit regressions cover CSRF rotation and concurrent recovery, authentication response races, logout errors, stale upload/read/save results, account isolation, inspection drafts, parcel jobs, and map geometry/lifecycle behavior.
- All five Vite production builds passed with React 19.3, ArcGIS Maps SDK 5.1.26, and CesiumJS 1.145.
- Service request browser tests passed reporter creation, staff assignment and resolution, actual ActionCable message delivery to a separate session, reload persistence, malformed import rejection, duplicate import prevention, and background CSV export.
- Data portal browser testing passed clean, mixed, and fully rejected uploads; PostGIS validation; staff approval delivered to another session through WebSockets; byte-level export SHA256 verification; and ownership restrictions.
- Fleet browser testing passed ten-vehicle telemetry, geofence entry events, replay controls, pause stability, and persistence after reload.
- Parcel browser testing passed map-linked table selection, asynchronous server calculation, comparison, downloaded calculation snapshots, persistence, and mobile layout checks.
- Infrastructure browser testing passed real Cesium corridor rendering, asset height controls, reporter observations, staff resolution, actual ActionCable delivery, profile job completion, 71-point GeoJSON export, and mobile layout checks.
- Authentication browser checks verify copied-cookie revocation and explicit CSRF rejection on each app, plus immediate disconnection of an authenticated live subscription after logout.
- The two-tab browser regression verifies logout propagation, account changes, and removal of the prior account's draft without waiting for periodic polling.

Browser tests run against real Rails APIs, PostgreSQL, Redis, and workers. They add timestamped synthetic records to the development databases. React unit tests use mocks only for focused component/request behavior.

The audit corrected a browser-test race that selected an existing completed export before the newly requested report appeared. The test now follows exact import/export IDs from POST responses and retains the CSV content and deduplication assertions.

Visual evidence in ignored `.runtime/`: `parcels-desktop.png`, `parcels-mobile.png`, `portal.png`, `infrastructure-desktop.png`, and `infrastructure-mobile.png`. The rendered maps and 3D scene were visually inspected.

## Deployment and recovery checks

- All five Rails applications passed production eager-load checks, production database queries, and verification of the Sidekiq queue adapter.
- All five Compose configurations passed `docker compose config --quiet`.
- Fresh production migrations passed for all five applications using a restricted database role. They created zero user accounts and left PostGIS owned by the administrator. Temporary validation databases and their role were removed after verification.
- Two Node runtime regressions passed. The shell lifecycle regression passed seed-free startup, exclusive supervisor ownership, termination cleanup, and stale/corrupt PID handling.
- The extended shell regression verifies that stale PID files cannot terminate an unrelated process whose command contains `sidekiq`. A real PostgreSQL regression verified punctuation-containing passwords through all five Compose connection definitions.
- `npm audit --omit=dev` reported zero known production JavaScript dependency vulnerabilities on the audit date.
- All five apps passed HTTP checks: `/up` responds, unknown hosts are rejected for API requests, allowed hosts can fetch session state, and mutation requests without CSRF tokens are rejected.
- Container origins allow both documented loopback names. API, worker, and migrations wait for healthy Redis; API and worker wait for database initialization.
- A service-request database backup restored successfully into a new temporary database. All eight issues present at backup time were restored, record counts matched, and spatial validity queries passed. The successful verification database was removed afterward. The backup excludes the administrator-owned PostGIS reference table data.
- CI configuration parses and includes backend tests, React tests, builds, and real browser workflows. CI and Docker PostgreSQL clients are explicitly version 17 to match the supplied PostGIS 17 container.

## Container verification (October 1, 2026)

The [container workflow](.github/workflows/containers.yml) ran `scripts/container-smoke.sh` for all five projects on GitHub Actions (`ubuntu-24.04`, [run 36921811790](https://github.com/efkopru/geospatial-web-lab/actions/runs/36921811790)). Every project built its backend and frontend images and started PostGIS, Redis, migrations, the API, the Sidekiq worker and nginx. Each project then passed these checks:

- migrations completed as the restricted application role
- the frontend bundle, `/up` and `/api/session` responded through nginx
- `db:seed` loaded inside the API container
- a Sidekiq process registered in Redis
- the API, worker and web containers ran without restarts

This covers container build and startup on a CI runner. It does not cover a hosted deployment, TLS, or long-running operation.

## Full-stack performance (October 1, 2026)

The [benchmark workflow](.github/workflows/fullstack-benchmark.yml) starts each Compose stack with `scripts/container-smoke.sh` and runs `scripts/fullstack-benchmark.mjs`. The script signs in through nginx as a seeded staff user and measures:

- API latency over sequential requests
- read throughput with 10 concurrent clients
- the time from the request that queues a Sidekiq job until polling shows it finished

Runs used GitHub-hosted `ubuntu-24.04` runners, with every service of one app on a single runner. Data Quality results come from [run 36930398798](https://github.com/efkopru/geospatial-web-lab/actions/runs/36930398798), after the fix below. The other apps come from [run 36929216260](https://github.com/efkopru/geospatial-web-lab/actions/runs/36929216260).

| App | Operation | Data size | Result |
| --- | --- | --- | --- |
| 01 Civic Works | Create one request | seeded data | median 10.8 ms, p95 112.3 ms (50 requests) |
| 01 Civic Works | Import 500 point features (worker + PostGIS) | growing to ~4,000 requests | median 1.06 s, max 1.95 s (8 jobs) |
| 01 Civic Works | List with 1 km distance filter | 4,056 requests | median 10.4 ms, p95 23.3 ms |
| 01 Civic Works | Concurrent list with distance filter | 4,056 requests | 111.1 requests/s, p95 136.8 ms |
| 01 Civic Works | Generate CSV export (worker) | 4,056 requests | median 0.23 s, max 0.41 s (5 jobs) |
| 02 Data Quality | Upload and validate GeoJSON (worker + PostGIS) | 500 polygons x 16 vertices (329 KB) | median 1.86 s (3 jobs) |
| 02 Data Quality | Upload and validate GeoJSON (worker + PostGIS) | 2,000 polygons x 16 vertices (1.3 MB) | median 7.17 s (3 jobs) |
| 02 Data Quality | Upload and validate GeoJSON (worker + PostGIS) | 2,000 polygons x 64 vertices (4.9 MB) | median 9.92 s (3 jobs) |
| 02 Data Quality | Dataset list | 11 datasets | median 4.6 ms, p95 9.3 ms |
| 02 Data Quality | Dataset detail with records | 2,000 records | median 342.1 ms, p95 444.3 ms |
| 02 Data Quality | Concurrent dataset list | 11 datasets | 183.8 requests/s, p95 71.0 ms |
| 03 Fleet Monitor | Record manual telemetry (PostGIS geofence check) | 10 vehicles | median 13.4 ms, p95 29.2 ms (400 requests) |
| 03 Fleet Monitor | Fleet snapshot | after telemetry | median 12.3 ms, p95 18.1 ms |
| 03 Fleet Monitor | Vehicle history | up to 360 points | median 5.8 ms, p95 10.7 ms |
| 03 Fleet Monitor | Concurrent fleet snapshot | 10 vehicles | 75.5 requests/s, p95 188.1 ms |
| 04 Parcel Scenarios | Save and calculate a scenario (worker + PostGIS area) | 6 parcels | median 0.13 s, max 0.33 s (20 jobs) |
| 04 Parcel Scenarios | Scenario list | 22 scenarios | median 3.8 ms, p95 8.4 ms |
| 04 Parcel Scenarios | Concurrent parcel layer | 24 parcels | 334.2 requests/s, p95 46.8 ms |
| 05 Inspections | Generate corridor profile (worker + PostGIS geography) | 8 assets, 71 samples | median 0.15 s, max 0.65 s (15 jobs) |
| 05 Inspections | Asset register | 8 assets | median 4.4 ms, p95 9.5 ms |
| 05 Inspections | Concurrent asset register | 8 assets | 194.7 requests/s, p95 75.5 ms |

The first run found one defect. The Data Quality dataset list took 140.6 ms for 11 datasets and served only 8.5 requests/s with 10 concurrent clients (p95 1.4 s). It loaded every dataset's source JSONB and each approved version's stored content and export, which can be megabytes each. List and detail reads now select only summary columns, and a regression test checks the SQL they issue. In the second run the same list took 4.6 ms and served 183.8 requests/s.

These are single-runner measurements on synthetic data, without a load balancer, TLS, or production tuning. They show where time goes and catch regressions. They are not capacity guarantees. Validating a large upload is the slowest workflow (about 10 s for 2,000 complex polygons); it runs in the background while the client polls. Action Cable fan-out under many subscribers was not measured.

## Review fixes (October 4, 2026)

Checked locally on the review-fixes branch in the same WSL runtime.

| Project | Tests | Assertions | Result |
| --- | ---: | ---: | --- |
| Service requests | 31 | 233 | Passed |
| Data quality portal | 28 | 193 | Passed |
| Fleet monitor | 25 | 154 | Passed |
| Parcel scenarios | 24 | 151 | Passed |
| Infrastructure inspections | 30 | 218 | Passed |
| Total | 138 | 949 | No failures, errors, or skipped tests |

- New backend coverage: failed sign-in limits per email and per address, `authenticate_by` rejections, expired-session pruning, and the Sidekiq retry policy of the import, export, validation, and scenario jobs.
- The parcel and inspection domain migrations rolled back to version 1 and migrated again on throwaway databases.
- 50 frontend tests passed across 11 suites, including refetch limits in the data portal, memoized map features in the fleet and parcel apps, and the sign-in form without demo accounts. The standalone editions passed 70 domain and storage tests and 10 interface tests; the built standalone site passed `verify:site` (29 URLs) and `verify:browser` against a local preview. The copied-file check passed 28 comparisons.
- ESLint reported no errors and 21 hook-dependency warnings. Brakeman 8.1.0 reported no warnings for any backend with the end-of-life Ruby check excluded; that check flags the local Ruby 3.2.3, which reached end of life on 2026-03-31. CI and the container images use Ruby 3.4.
- All five Vite builds passed. The inspections entry bundle is 263 KB (82 KB gzipped), down from 4.43 MB (1.21 MB gzipped), because the Cesium viewer now loads in its own chunk.
- `scripts/nginx.conf` was run with nginx 1.24 against the built service-requests frontend: security headers on pages, assets and proxied responses; `no-cache` for `index.html` and client routes; a one-year cache and gzip for hashed assets; and 404 for a missing asset.
- Not run locally: the Playwright scenarios against running services and the container image builds (the Docker engine is unavailable here). The CI and container workflows run both.

## Review follow-ups (October 5, 2026)

- Backend: 142 tests with 964 assertions passed (service requests 31/233, data quality 28/193, fleet 27/159, parcels 25/156, inspections 31/223).
- Fleet replay, measured over 60 frames of the seeded fleet (10 vehicles) in a rolled-back transaction: SQL statements per frame fell from 118 to 70 with 2 geofences and from 201 to 73 with 6. A fingerprint of the resulting telemetry, memberships, events and vehicle positions was identical before and after. Frame time fell from roughly 105–150 ms to 72 ms (2 geofences) and from 160–280 ms to 100 ms (6 geofences); WSL timings vary between runs.
- An asset detail with four inspections now takes 8 queries instead of 14, the same as with one. The scenario list returns the 100 most recent scenarios without parcel snapshots.
- ESLint reports no errors or warnings and now fails on any warning. Root Vitest 50/50, standalone 70 domain and storage tests and 10 interface tests, copied-file check 28/28, all five Vite builds, and the standalone `verify:browser` check passed. The service-request draft reset, map rendering and 3D focus were checked by hand in the built standalone site.
- Compose was left unchanged: the container workflow log shows BuildKit building the backend image once and only exporting the migrate, API and worker tags in parallel (about 1.2 s).

## Boundaries

Docker Desktop's engine failed to start in the original audit environment, so container image builds and runtime execution were **not verified** locally. They were later verified on GitHub Actions; see [Container verification](#container-verification-october-1-2026). The same applications were run and tested directly in WSL. At the time of this local audit, the workspace had not yet been published and remote CI had not run. Subsequent CI results are recorded in [GitHub Actions](https://github.com/efkopru/geospatial-web-lab/actions). No public application hosting was created then. The standalone browser editions were later published as a static demo; see the [standalone verification record](standalone/VERIFICATION.md#public-deployment-october-1-2026). The full-stack applications remain unhosted.

The ArcGIS basemap and SDK asset delivery need internet access. Business records remain in the local application databases. Cesium corridor data and elevations are synthetic, with no terrain-service token required. Browser rendering requires WebGL.

Reproduce checks using the commands in the root README and project-specific READMEs. Startup migrates existing databases without running demo seeds. Seeding is an explicit separate action. [AUDIT.md](AUDIT.md) lists the corrected defects.

The first audit recorded 94 backend tests, 36 frontend tests, and 12 browser scenarios. The figures above include the [second audit](AUDIT_SECOND_PASS.md). Its parcel concurrency test was additionally verified with the original failing random seed, 4284, after narrowing an overly broad test hook.
