# Civic Works standalone

From the standalone suite directory, install dependencies with `npm ci`, then run `npm run dev:1`. Open [Civic Works](http://127.0.0.1:5271/). This individual launcher does not start the comparison gallery. The original full-stack application remains on port 5171. See the [suite README](../README.md) for the combined gallery launcher, browser requirements and production preview.

The copied interface supports creation, map/register selection, text/category/status/distance filters, assignment, valid lifecycle transitions, stale edit checks, GeoJSON imports with row findings and duplicate detection, and CSV snapshots. Data persists in this app's separate IndexedDB database. Reset restores six synthetic requests. Staff/reporter/crew selection is a demonstration, not authentication.

Imports and CSV generation run immediately in the browser. There is no worker queue. Distance uses a mean-radius spherical haversine calculation, so it can differ slightly from the original PostGIS ellipsoidal geography distance. The map still uses an online ArcGIS basemap. Reporter views show that role's records; staff views show all local requests. Export reports ignore workspace filters, matching the full-stack workflow.

Limits: 500 features and 2 MB per import, 5000 local requests, 100 retained import fingerprints, 30 retained CSV snapshots (the newest 10 for the selected staff role appear). Map/register results show at most 500 matches while counts summarize all matches. Export a local backup before reset. Backups are downloadable JSON records; automatic restoration of backup files is not implemented.
