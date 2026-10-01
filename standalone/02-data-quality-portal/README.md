# Standalone Data Quality Portal

This separate browser application reproduces the upload, review, approval, and export workflow using local data. The original Rails/PostGIS application in `../../02-data-quality-portal` is unchanged. There is no Rails API, Redis queue, worker process, or WebSocket dependency in this edition.

Use the [standalone launcher instructions](../README.md) to install dependencies, start this app, and build its static files. Serve it through localhost or HTTPS; do not open `index.html` using a `file:` URL. SHA-256 approval requires a secure browser context.

## Try the workflow

1. Choose the reporter demo role. The initial library contains **Parks Clean**, already approved with four accepted features, and **Parks With Errors**, with two accepted and four rejected features.
2. Open **Parks With Errors**. Inspect the accepted map, filter rejected records, and select record rows to read their source GeoJSON. The errors illustrate a missing `asset_id`, a crossing polygon, an invalid latitude, and an unclosed polygon ring.
3. Open **Upload GeoJSON**. Choose or drop your own GeoJSON file, or use either sample-loading button. Provide a dataset name and comma-separated required attributes, then select **Import and validate**. The source stays inside this browser. An identical source and attribute policy uploaded by the same role reuses its existing dataset.
4. Switch to the staff demo role. Staff can view all local datasets; the reporter sees only datasets associated with its demo identity. These controls demonstrate the original workflow and are not authentication or a security boundary.
5. For an upload containing rejected records, acknowledge their exclusion before selecting **Approve valid features**. A dataset with zero accepted records cannot be approved.
6. Download the approved GeoJSON. It contains only accepted features in their original order. The displayed SHA-256 is calculated from the exact downloaded UTF-8 bytes.
7. Reload the page to verify persistence. Use the shared local-data controls to export or restore a backup, or reset this app's synthetic data.

The sample files are also available in [public/samples](public/samples). Importing a sample as staff creates a staff-owned copy; importing the unchanged sample as reporter opens its existing seeded dataset.

## Features

| Feature | Standalone behavior |
|---|---|
| Dataset library and summary cards | Counts, owner names, ready/approved status, and selection come from this app's IndexedDB state. |
| File selection and drag/drop | Reads JSON locally, with a 5 MiB byte limit. Replacing a file with an invalid file clears the previous selection. |
| Import policy | Requires a named GeoJSON FeatureCollection containing 1 to 2,000 features. Up to ten required attribute names can contain letters, digits, and underscores, starting with a letter or underscore. |
| Required attributes | Each named property must exist directly on the feature's properties object and be nonblank. Zero and `false` count as supplied values. |
| Geometry structure | Supports Point, MultiPoint, LineString, MultiLineString, Polygon, and MultiPolygon. Positions must contain exactly two finite numbers within WGS84 longitude/latitude ranges. Lines and polygon rings have minimum lengths; rings must close. |
| Topology | Runs JSTS `IsValidOp` on structurally valid features. It detects problems such as crossing polygons, holes outside shells, overlapping MultiPolygon members, and degenerate lines. |
| Review | Shows every input record, its accepted/rejected state, validation messages, source JSON, summary bars, and acceptance percentage. |
| Map | Displays only accepted features; map and record selection are linked. Map content uses the shared ArcGIS viewer. |
| Approval | Staff demonstration role only. Requires completed validation, at least one accepted feature, and an explicit acknowledgment if rejected features are excluded. |
| Version snapshot | Canonically serializes accepted GeoJSON and stores a separate export string and SHA-256 digest. Repeated approval does not overwrite it. Editing a review/source object does not regenerate an approved export. |
| Download | Creates a local GeoJSON Blob containing the stored version bytes. No server download endpoint is contacted. |
| Duplicate handling | Canonical object-key ordering makes equivalent JSON objects match; feature order and required-attribute policy still matter. Deduplication is scoped by demo owner. |
| Persistence and local updates | IndexedDB persists datasets across reloads on the same origin. The shared runtime notifies local subscribers after successful writes. |

## Comparison with the full-stack version

| Concern | Original application | Standalone edition |
|---|---|---|
| Geometry engine | PostGIS/GEOS checks | JSTS/JTS checks in JavaScript |
| Processing | Sidekiq background job with persisted progress | Local processing during the import action; keep the page open until it finishes |
| Ownership | Server-enforced signed-in users | Simulated roles inside a single browser data store |
| Approval history | Database-backed version | Fixed snapshot maintained by this application's code |
| Shared access | Other authenticated clients use server state | Other devices and browser profiles have independent state |
| Recovery | Worker retry and database persistence | Shared browser backup, restore and reset controls; interrupted uncommitted imports must be repeated |

JSTS is a JavaScript port of the JTS topology suite. It applies planar OGC geometry validity rules, but this edition does **not** claim complete behavioral or numerical equivalence with the original PostGIS build. The regression tests cover the bundled examples, invalid coordinates, self-crossing polygons, holes outside shells, overlapping multipolygons, and degenerate lines. See the [JSTS project](https://github.com/bjornharrtell/jsts) for its algorithms, licenses, and precision caveats.

This edition rejects features containing more than **10,000 coordinate positions** to bound individual browser operations. It accepts 2D longitude/latitude coordinates only. It does not transform coordinate systems, repair geometry, split antimeridian crossings, or validate real-world attribute meaning. Required-attribute checks concern presence and nonblank values, not uniqueness or data types. No geometry is accepted after a topology-engine exception.

The application stores complete source records and review results locally. Browser storage capacity is finite; clearing site data removes them. Stored data can also be modified through browser tools. A fixed application snapshot and a matching digest demonstrate export reproducibility, not tamper resistance or a protected audit trail. Shared controls can reset seeded and imported data.

The shared backup button exports an inspectable JSON archive of local state, and **Restore local backup** replaces local state with such a file. The GeoJSON upload workflow imports datasets; it does not read application backups.

After a static production build, the validation engine and app code are local assets. ArcGIS basemaps and external map resources still require internet access. The application does not promise a fully offline map.

## Validation

The focused tests are in [`../tests/quality.test.js`](../tests/quality.test.js). They verify fixture counts and digest correctness, malformed input rejection, topology failures, role scope, rejected-record acknowledgment, zero-valid-record blocking, stable approved export bytes, canonical duplicate detection, and source keys that resemble JavaScript prototype names. Run them through the standalone test command described in the launcher README.
