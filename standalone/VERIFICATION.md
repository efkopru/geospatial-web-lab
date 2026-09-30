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

## Scope of the evidence

The browser checks used locally served production files with internet access for ArcGIS resources. They did not publish GitHub Pages or test a desktop installer, complete offline operation, every device/browser combination, or operational GIS datasets. Simulated roles are not authentication. The mathematical differences from PostGIS and local-storage limits are documented in [COMPARISON.md](COMPARISON.md).
