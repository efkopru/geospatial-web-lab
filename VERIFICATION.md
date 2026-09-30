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

## Boundaries

Docker Desktop's engine failed to start in this environment. Container image builds and container runtime execution are **not verified** here. The same applications were run and tested directly in WSL. At the time of this local audit, the workspace had not yet been published and remote CI had not run. Subsequent CI results are recorded in [GitHub Actions](https://github.com/efkopru/geospatial-web-lab/actions). No public application hosting was created.

The ArcGIS basemap and SDK asset delivery need internet access. Business records remain in the local application databases. Cesium corridor data and elevations are synthetic, with no terrain-service token required. Browser rendering requires WebGL.

Reproduce checks using the commands in the root README and project-specific READMEs. Startup migrates existing databases without running demo seeds. Seeding is an explicit separate action. [AUDIT.md](AUDIT.md) lists the corrected defects.

The first audit recorded 94 backend tests, 36 frontend tests, and 12 browser scenarios. The figures above include the [second audit](AUDIT_SECOND_PASS.md). Its parcel concurrency test was additionally verified with the original failing random seed, 4284, after narrowing an overly broad test hook.
