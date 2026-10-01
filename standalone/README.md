# Geospatial Web Lab: standalone browser editions

Five separate browser applications preserve the original interfaces and useful workflows while replacing Rails APIs, PostGIS databases, Redis, Sidekiq and Action Cable with local JavaScript and browser storage. The original full-stack projects remain in their existing repository folders and are unchanged by these additions.

These editions use synthetic data. They are suitable for interactive demonstrations and learning. They are not deployed operational systems, authenticated multi-user applications or exact replacements for the original spatial engines. Read [COMPARISON.md](COMPARISON.md) for the feature and architecture differences.

## Requirements

- Node.js 22.12 or later and npm. Node 24 is the development reference version.
- A modern Chrome or Edge browser, with JavaScript, IndexedDB and WebGL enabled.
- Open through `http://127.0.0.1`, `http://localhost` or HTTPS. Opening an HTML file directly with a `file:` URL is unsupported.
- Fleet playback requires the Web Locks API to prevent competing replay timers across tabs. Unsupported coordination disables playback rather than running duplicate simulations.
- Internet access is required for ArcGIS SDK resources and basemaps used by the 2D maps. Local data and calculations do not require a Rails server. The suite does not promise fully offline maps.

The infrastructure scene uses bundled Cesium resources, synthetic surfaces and ellipsoid terrain. It requires WebGL but no terrain-service access token. SHA-256 approval in the data-quality app requires a secure browser context, provided by localhost or HTTPS.

## Install and start

From the repository root, enter `standalone` before running npm commands:

```powershell
cd standalone
npm ci
npm run dev
```

`npm run dev` starts all five standalone applications plus the [comparison gallery on port 5270](http://127.0.0.1:5270/). In development, each gallery card redirects to the corresponding app on ports 5271 through 5275. Keep the terminal open. Ctrl+C stops the launcher and its child processes.

| Application | Standalone URL | Start one standalone app | Original full-stack UI |
| --- | --- | --- | --- |
| [Civic Works service requests](01-service-requests/README.md) | [127.0.0.1:5271](http://127.0.0.1:5271/) | `npm run dev:1` | [127.0.0.1:5171](http://127.0.0.1:5171/) |
| [Data quality portal](02-data-quality-portal/README.md) | [127.0.0.1:5272](http://127.0.0.1:5272/) | `npm run dev:2` | [127.0.0.1:5172](http://127.0.0.1:5172/) |
| [Fleet monitor](03-fleet-monitor/README.md) | [127.0.0.1:5273](http://127.0.0.1:5273/) | `npm run dev:3` | [127.0.0.1:5173](http://127.0.0.1:5173/) |
| [Parcel scenarios](04-parcel-scenarios/README.md) | [127.0.0.1:5274](http://127.0.0.1:5274/) | `npm run dev:4` | [127.0.0.1:5174](http://127.0.0.1:5174/) |
| [Infrastructure inspections](05-infrastructure-inspections/README.md) | [127.0.0.1:5275](http://127.0.0.1:5275/) | `npm run dev:5` | [127.0.0.1:5175](http://127.0.0.1:5175/) |

The individual `dev:1` through `dev:5` commands start only the selected app, without a gallery server. Use either the combined launcher or the individual launchers for a given port. Running both on the same port produces a port conflict. The original apps are started separately using the [full-stack instructions](../HOW_TO_USE.md). A standalone app's **Open full-stack version** link does not start Rails or its frontend.

## Use local data and simulated roles

Each app starts with its own synthetic dataset and a staff demo identity. The **Demo role** selector switches between Alex Morgan (staff), Jordan Lee (reporter) and Casey Rivera (staff). **Leave demo** opens the role-selection screen. No password is needed.

Role checks demonstrate the original workflow: reporters have restricted request/dataset views, staff can approve or resolve records, and parcel scenarios belong to the selected demo identity. These are local application checks, not authentication or protection against someone controlling the browser.

Each application uses a separate IndexedDB database. Collections are stored one record per entry and a change writes only what it touched, so saves stay fast as data grows; opening an app reads all of its stored data. Changes persist across reloads on the same browser profile and origin. `localhost`, `127.0.0.1`, different ports and a hosted site are different origins, so they have separate data. An app running in development and the same app inside the built gallery can therefore show different local records. Data is not synchronized with the full-stack databases or other devices.

**Export local backup** downloads the current app's stored state as JSON. **Restore local backup** reads such a file and, after confirmation, replaces only that app's local data with the backup's state. A restore accepts only a backup that meets all of these conditions:

- exported by the same app
- uses the current backup version
- has the expected top-level structure
- each record of a seeded record type has the fields the app reads, with the expected value types
- the file is at most 120 MB

Rejected files leave local data unchanged. A restore replaces the whole local dataset; it does not merge records. Other open tabs of the app receive the restored state. A restored Fleet Monitor replay starts paused. The backup controls are disabled while a restore or reset is running. Backups are written as compact JSON. Indented backups from earlier exports can still be restored. App-specific GeoJSON, JSON and CSV export buttons produce the workflow outputs described in each app's README.

**Reset demo data** asks for confirmation and then replaces only that standalone app's data with its initial synthetic dataset. It leaves the other standalone apps and the original full-stack databases unchanged. Browser site-data clearing, private browsing and storage eviction can also remove records.

Local subscribers update after successful writes; compatible tabs share changes through browser mechanisms. There is no authenticated WebSocket connection or server event stream. Fleet replay runs in one coordinated browser tab. Closing the processing tab pauses replay on leadership handover; returning later requires an explicit start. Closing the browser stops all browser processing.

## Build and preview

From `standalone`:

```powershell
npm run build
npm run preview
```

The build creates each application's `dist` directory and assembles a comparison gallery in `standalone/dist`:

```text
standalone/dist/
  index.html
  .nojekyll
  01-service-requests/
  02-data-quality-portal/
  03-fleet-monitor/
  04-parcel-scenarios/
  05-infrastructure-inspections/
```

`npm run preview` starts the built gallery on port 5270 and serves the five individual production builds on ports 5271 through 5275. Stop development servers first. Preview requires a completed build. The built gallery serves apps under its own subdirectories, such as `http://127.0.0.1:5270/04-parcel-scenarios/`; it does not redirect them to their individual ports. Gallery data on origin 5270 is separate from data on each app's individual port.

To serve only the assembled gallery and its built app subdirectories, without the five individual preview servers, run:

```powershell
node scripts/serve.mjs preview
```

Open [the local gallery](http://127.0.0.1:5270/). Use either this gallery-only command or the combined preview launcher, because both use port 5270. Servers bind to `127.0.0.1`. Relative build paths let the gallery and its app subdirectories be served together by static hosting. Building static files does not publish them or establish a GitHub Pages deployment.

## Publishing a static demo

The manual [Publish standalone demo](../.github/workflows/standalone-pages.yml) workflow tests and builds the suite, checks the built gallery through the local preview server, uploads `standalone/dist` to GitHub Pages and then checks the deployed URL. It runs only when started from the Actions tab, because publishing makes the browser editions public. Before the first run, set **Settings > Pages > Source** to **GitHub Actions**. Pages for a private repository requires a GitHub plan that supports it.

`npm run verify:site -- <url>` checks any served copy of the build, local or hosted. It confirms that the gallery links all five apps and that each app's scripts, styles, icon and third-party notices are served with the expected content types. It also checks the Cesium assets for app 05 and the license copies at the gallery root. A host that answers missing files with its HTML page fails the check. The script does not open a browser, so IndexedDB persistence, WebGL rendering, ArcGIS basemaps and downloads still need a manual check on the deployed URL (see [VERIFICATION.md](VERIFICATION.md)). On a public host, the gallery and app shells hide the links to the local full-stack apps.

`node scripts/benchmark.mjs` measures the local adapters at their storage limits; the latest results are in [VERIFICATION.md](VERIFICATION.md#performance-baseline-october-1-2026).

Generated `dist`, dependency directories and local output are excluded by this suite's `.gitignore`. Commit source and lockfiles; rebuild static files when preparing a deployment. [Third-party notices](THIRD_PARTY_NOTICES.md) and license copies are included with the app builds and assembled gallery.

## Verification commands

```powershell
npm test
npm run test:ui
npm run build
npm run verify:site -- http://127.0.0.1:5270/   # while node scripts/serve.mjs preview is running
```

Domain and shared-runtime tests cover calculations, validation, simulated permissions, persistence behavior and replay coordination. Interface tests and production builds cover different concerns; none substitutes for browser inspection of WebGL rendering and actual workflows. If a restricted Windows shell prevents Node's test runner from spawning subprocesses, use `node --test --test-isolation=none tests/*.test.js` for the Node test suite.

Read [VERIFICATION.md](VERIFICATION.md) for dated check results and screenshots. This setup guide does not claim that every browser workflow, hosted deployment, offline behavior or container configuration has been verified. Keep recorded verification evidence separate from the application capabilities and commands documented here.
