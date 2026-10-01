# Standalone infrastructure inspections

This browser edition displays eight synthetic corridor assets in Cesium and stores observations, history and calculated profile snapshots through the shared IndexedDB runtime. No Rails API, spatial database or durable background worker is required.

Follow the [suite setup instructions](../README.md). From `standalone`, `npm run dev:5` starts this app at [127.0.0.1:5275](http://127.0.0.1:5275/). The combined launcher also starts the comparison gallery. The original full-stack UI remains on port 5175.

## Features

- Explore poles, towers and cabinets in a 3D scene. Select an asset through the scene or register, focus on the selected asset, and return to the full corridor.
- Toggle labels and choose actual height, 3 times or 5 times visual exaggeration. Exaggeration changes only the scene; recorded heights and elevations remain unchanged.
- Filter the register to assets with open observations. Counts and scene status update when observations are created, resolved or reopened. Open observations appear amber; open critical observations appear red.
- Inspect structure height, synthetic base elevation and top elevation as distinct values.
- Add observations with severity, notes, author and observation time. Notes must contain 10 to 2,000 characters; invalid dates and times more than five minutes in the future are rejected.
- Use a staff demo role to resolve or reopen observations with explanatory notes. Every change appends an actor, action and timestamp to the local history.
- Reject stale status changes using a version number. A form opened before another accepted edit must reload before it can write again.
- Generate an actual 71-point corridor profile in the browser, inspect its chart and sample table, and download its GeoJSON.
- Review the ten most recent profile runs. The browser keeps the newest 20 completed runs and removes older completed runs so each save stays small. Failed or pending runs are kept so they can be retried. A tab that still shows a removed run reports that it was not found. Completed runs preserve the source asset snapshot and remain independent of subsequent observations or source changes.
- Export or restore a browser backup, or reset the demo from the shared controls.

## Profile mathematics

For every adjacent pair of corridor assets, the adapter calculates the shortest spherical great-circle distance with the haversine formula and a mean Earth radius of 6,371,008.8 metres. Samples follow that great circle at tenths of each segment. Longitude differences are normalized across the antimeridian. Coincident endpoints produce a zero-length segment; exactly antipodal endpoints are rejected because they do not define a unique path.

Ground elevation is linearly interpolated between each pair of synthetic asset base elevations. Seven segments contribute ten samples each; the final endpoint adds the 71st sample. Summary values include total length, minimum and maximum synthetic ground elevations and the highest asset top.

The calculation uses a spherical approximation rather than the original PostGIS ellipsoidal geography calculation. Results can differ slightly. The method is disclosed in the interface, run metadata and GeoJSON export. The interpolated surface is not a DEM, surveyed terrain or an engineering clearance assessment.

## Browser behavior and boundaries

Profile generation runs immediately in the browser. It does not queue work on a server or continue after the browser closes. Retry handling is available for a failed local run, but normal valid synthetic profiles finish during their creation action.

Observations and profile runs are shared among the three demo users within this app's browser store, matching the shared asset-register workflow. Only staff demo roles can change observation status. This is role simulation, not authentication: anyone controlling the browser can inspect or modify its storage. The original full-stack app retains server authorization and database audit controls.

The Cesium scene uses synthetic asset surfaces and requires WebGL. It does not require an external terrain token. Browser storage can be cleared or evicted; the shared backup export preserves an inspectable JSON archive that the shared restore control can load again. The shared runtime controls persistence, reset and browser-tab coordination.

## Tests

From the repository root, run `node --test standalone/tests/inspections.test.js`. Tests cover numerical distances, antimeridian interpolation, sample counts, source snapshots, GeoJSON exports, author attribution, role restrictions, stale edits, status history, input validation and read-only routes.
