# Standalone verification record

Verified locally on September 29, 2026, using Windows, Node.js 24, and the Codex Chromium browser. The browser checks used production builds served from the comparison gallery at `http://127.0.0.1:5270/`, including each application's subdirectory.

## Original applications preserved

SHA-256 checks of all **371 previously tracked files** against the pre-conversion manifest found no changes. The standalone suite owns its source, dependencies, synthetic seed data, and browser databases. The new CI workflow is a separate file. No original Rails/database workflow was replaced.

## Automated verification

- **51 Node tests passed**, covering domain validation, ownership simulation, spatial calculations, stale edits, persistence, failed-write rollback, concurrency, replay leadership, local reset, and seven launcher/static-server regressions.
- **Seven interface tests passed**, covering role/session rendering, refreshed scenario/profile selections, and actual Blob download interception, contents, cleanup, and errors.
- All five applications build as static assets using relative paths.
- The single-app development command served its page and notices successfully. The combined production preview served the gallery, all five individual ports, and all five gallery subpaths. A slashless app URL redirected to the correct slash-terminated path while preserving its query string.
- `npm audit --audit-level=low` reported **zero known vulnerabilities** for the standalone lockfile on the verification date.
- The separate [standalone CI workflow](../.github/workflows/standalone.yml) runs installation, domain tests, interface tests, and all five production builds on Ubuntu with Node.js 24. Local results and CI results are separate evidence.

Run the commands in [README.md](README.md) to repeat the automated checks. A passing test suite does not establish complete browser compatibility or production readiness.

## Browser acceptance checks

| Application | Actions and observed result |
| --- | --- |
| Civic Works | Created a seventh request, assigned it to Casey Rivera, and reloaded. The request and assignment persisted. Generated and downloaded a CSV containing seven request rows. Downloaded a valid JSON backup of the local state. |
| Data quality portal | Reviewed a six-feature example with two accepted and four rejected records. Approved the accepted subset after acknowledging exclusions. Downloaded its two-feature GeoJSON and verified its exact SHA-256 against the displayed digest. Loaded the clean sample as the staff identity, obtaining four accepted features. Repeating that import reused the existing dataset. Switching to the reporter identity showed only its two datasets. |
| Fleet monitor | Ran ten synthetic vehicles at 4x, reached frame 120, paused, and reloaded. Frame 120, the selected speed, retained telemetry, and paused state survived. Routes, geofences, vehicle selection, speed bars, and entry/exit chronology rendered. |
| Parcel scenarios | Selected two parcels and calculated a four-floor, 40%-coverage scenario with a 900-square-foot unit assumption. The result contained 954 units, 1,074,256 square feet of gross floor area, and FAR 1.6. Compared it with the seeded mixed-use scenario, downloaded JSON, and verified the new scenario survived reload. |
| Infrastructure inspections | Rendered the Cesium corridor, selected a tower, focused the scene, and used 3x display exaggeration while the recorded height remained 42 metres. Created and resolved an observation with notes; its resolved status and two-event history survived reload. Generated a 71-sample profile and downloaded its GeoJSON. |

The downloaded approved dataset had SHA-256 `50990aa8dff2eb94cbee8654c259ddad840e4da6cbd39c8d92428df601dfd828`. Its export contained two accepted features. The profile export contained 71 features. CSV, scenario, profile, and backup downloads were read from actual browser-produced files and parsed successfully.

## Screenshots

These captures show synthetic acceptance-test data saved in the local gallery's browser origin. A fresh browser starts with the documented seed data, so counts and timestamps can differ. Each image is an actual application capture, not a mockup.

### Comparison gallery

![Standalone comparison gallery with links to all five editions](screenshots/00-comparison-gallery.jpg)

### Civic Works

![Standalone Civic Works request, assignment, map, and register](screenshots/01-service-requests.jpg)

### Data quality portal

![Standalone accepted and rejected records with approved export](screenshots/02-data-quality-portal.jpg)

### Fleet monitor

![Standalone paused replay, routes, telemetry, and zone events](screenshots/03-fleet-monitor.jpg)

### Parcel scenarios

![Standalone parcel selection and scenario comparison](screenshots/04-parcel-scenarios.jpg)

### Infrastructure inspections

![Standalone Cesium asset and calculated elevation profile](screenshots/05-infrastructure-inspections.jpg)

## Performance baseline (October 1, 2026)

`node scripts/benchmark.mjs` runs the real app adapters through the shared runtime: state clone, handler, envelope and IndexedDB write. It uses fake-indexeddb in Node and reports the median of five runs. It was run on Linux with Node.js 22 on a cloud Intel Xeon 2.8 GHz container. Absolute times differ between machines and browsers. The useful result is how cost grows with stored data. Every change rewrites the app's whole stored state, so a save gets slower as that state grows, while the domain logic itself stays fast. For example, JSTS validation of 2,000 polygons with 64 vertices each takes about 1 s by itself.

| App | Operation | Data size | Stored state after the runs | Median |
| --- | --- | --- | ---: | ---: |
| 01 Civic Works | Create one request | 6 requests | 4 KB | 0.8 ms |
| 01 Civic Works | List with 1 km distance filter | 6 requests | 4 KB | 0.6 ms |
| 01 Civic Works | Import 500 point features | 6 requests | 745 KB | 46.2 ms |
| 01 Civic Works | Generate CSV export | 6 requests | 1,975 KB | 92.1 ms |
| 01 Civic Works | Create one request | 1000 requests | 371 KB | 33.1 ms |
| 01 Civic Works | List with 1 km distance filter | 1000 requests | 371 KB | 12.6 ms |
| 01 Civic Works | Import 500 point features | 1000 requests | 1,119 KB | 63.7 ms |
| 01 Civic Works | Generate CSV export | 1000 requests | 2,885 KB | 135.1 ms |
| 01 Civic Works | Create one request | 2500 requests | 929 KB | 66.3 ms |
| 01 Civic Works | List with 1 km distance filter | 2500 requests | 929 KB | 36.0 ms |
| 01 Civic Works | Generate CSV export | 2500 requests | 2,211 KB | 84.8 ms |
| 01 Civic Works | Create one request | 4500 requests | 1,672 KB | 122.3 ms |
| 01 Civic Works | List with 1 km distance filter | 4500 requests | 1,672 KB | 58.7 ms |
| 01 Civic Works | Generate CSV export | 4500 requests | 3,987 KB | 164.6 ms |
| 02 Data Quality | Validate upload | 500 polygons x 16 vertices (327 KB) | 1,037 KB | 86.8 ms |
| 02 Data Quality | Validate upload | 2000 polygons x 16 vertices (1311 KB) | 4,127 KB | 298.6 ms |
| 02 Data Quality | Validate upload | 2000 polygons x 64 vertices (4974 KB) | 15,114 KB | 756.0 ms |
| 02 Data Quality | Small upload at the stored-upload budget | 4 datasets, 2 x 4.9 MB uploads | 30,286 KB | 4033.4 ms |
| 03 Fleet Monitor | Replay tick (10 vehicles) | empty history | 27 KB | 5.1 ms |
| 03 Fleet Monitor | Replay tick (10 vehicles) | history at 360 points per vehicle | 549 KB | 49.7 ms |
| 04 Parcel Scenarios | Save one scenario | 2 saved scenarios | 17 KB | 3.3 ms |
| 04 Parcel Scenarios | Save one scenario | 102 saved scenarios | 192 KB | 47.8 ms |
| 04 Parcel Scenarios | Save one scenario | 252 saved scenarios | 454 KB | 123.5 ms |
| 04 Parcel Scenarios | Save one scenario | 495 saved scenarios | 879 KB | 266.3 ms |
| 05 Inspections | Generate 71-sample profile | 0 stored profile runs | 47 KB | 2.7 ms |
| 05 Inspections | Generate 71-sample profile | 20 stored profile runs | 179 KB | 26.7 ms |

A Chromium 141 spot check used real IndexedDB and the same adapters, loaded through the Vite development servers (median of five runs, except the single first upload):

| App | Operation | Data size | Median |
| --- | --- | --- | ---: |
| 04 Parcel Scenarios | Save one scenario | 2 / 252 / 495 saved scenarios | 9.9 / 223.7 / 284.7 ms |
| 05 Inspections | Generate 71-sample profile | 0 / 20 stored profile runs | 291.2 / 262.4 ms |
| 02 Data Quality | First 2,000-polygon x 64-vertex upload (4.9 MB) | Seeded datasets only | 1,143.1 ms |
| 02 Data Quality | Small upload with 2 x 4.9 MB uploads stored (30 MB state) | 4 datasets | 2,246.4 ms |

Before these limits were added, the same checks found unbounded growth. In Chromium, a parcel save took 0.94 s with 2,000 saved scenarios and a profile run took 0.65 s with 500 stored runs. A small data-quality upload took 4.1 s with 56 MB of stored datasets. The standalone editions now enforce these limits:

- **Parcel scenarios:** at most 500 saved scenarios. Deleting scenarios frees space.
- **Profile runs:** only the newest 20 completed runs are kept. The workspace lists the newest 10.
- **Data Quality Portal:** at most 10 MB of uploaded GeoJSON in total, in addition to the 5 MB per-file limit. Each dataset stores its source, validated records and export snapshot, so stored state is about three times the uploaded size.

Civic Works already capped requests (5,000), imports (100) and retained CSV exports (30). The Fleet Monitor already capped history at 360 points per vehicle and 500 events.

These numbers describe single-tab browser work on synthetic data. They are not load tests of the full-stack services. Full-stack throughput, PostGIS query cost and Action Cable fan-out remain unmeasured.

## Scope of the evidence

The browser checks used locally served production files with internet access for ArcGIS resources. They did not publish GitHub Pages or test a desktop installer, complete offline operation, every device/browser combination, or operational GIS datasets. Simulated roles are not authentication. The mathematical differences from PostGIS and local-storage limits are documented in [COMPARISON.md](COMPARISON.md).
