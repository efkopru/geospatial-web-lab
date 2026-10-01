# Full-stack and standalone editions

The standalone suite adds five separate browser applications. It preserves the original projects and their backend implementations. Both editions use synthetic data and related interfaces, but they demonstrate different engineering responsibilities.

The full-stack edition demonstrates Rails APIs, server permissions, PostGIS, durable records, background jobs and authenticated change notifications. The standalone edition demonstrates browser interaction, local persistence and portable static delivery. No standalone action reads or changes a full-stack database.

## Architecture comparison

| Concern | Original full-stack edition | Standalone browser edition |
| --- | --- | --- |
| Launch | React development server plus Rails, PostgreSQL/PostGIS, Redis and workers | Static assets or a Vite development/preview server |
| Default frontend ports | 5171 through 5175 | 5271 through 5275 |
| Data | Separate PostgreSQL database for each app | Separate IndexedDB database for each app and browser origin |
| Identity | Password sign-in and revocable server sessions | Three simulated demo identities selected locally |
| Permissions | Rails verifies authenticated ownership and staff permissions | Local adapter applies demonstration rules; browser access can bypass them |
| Change updates | Authenticated Action Cable notifications, refresh and polling | Local subscriptions and compatible same-origin browser-tab notifications |
| Processing | Sidekiq workers with durable server state | JavaScript during actions; a coordinated browser timer for fleet replay |
| Closing the browser | Server work can continue | Browser calculations and replay stop |
| Shared access | Clients use the same authoritative server records | Browser profiles, origins and devices hold independent records |
| Persistence controls | Database administration and backups | JSON backup export, validated whole-app restore from those files, and app-specific reset |
| Spatial engine | PostGIS geography/geometry operations | App-specific JavaScript formulas and JSTS topology validation |
| Static hosting | Frontend can be static, but functional APIs require server hosting | Entire browser edition can be served as static files |
| Learning evidence | Full-stack integration, job processing and server reliability | Browser state, interactive workflows and explicit local-storage limits |

Neither edition establishes production readiness, operational adoption or numerical fitness for real planning or infrastructure decisions solely because its interface runs.

## 1. Civic Works service requests

| Feature | Standalone behavior |
| --- | --- |
| Request map and register | Preserved, with linked selection and text, category, status and distance filters. |
| Request creation | Local form validation and mapped request creation are preserved. |
| Reporter/staff scope | Reporters see their local requests; staff see the local operational collection. This is role simulation. |
| Assignment and lifecycle | Staff demonstration roles can assign requests and follow allowed status transitions. |
| Stale edit protection | Local versions reject conflicting updates instead of silently overwriting a newer accepted edit. |
| Import | GeoJSON is read locally; accepted rows, rejected-row findings and duplicate detection remain visible. |
| CSV export | Browser-generated snapshots can be downloaded. Export scope follows the full-stack workflow and is not limited by the current workspace filters. |
| Background work | Imports and exports run during the browser action; no job survives browser closure. |

Distances use a mean-radius spherical haversine formula rather than PostGIS ellipsoidal geography. Small differences are expected. The standalone store initially contains six synthetic requests; it is not a copy of whatever records currently exist in the full-stack database. Review the [app README](01-service-requests/README.md) for import, result and retention limits.

## 2. Data quality portal

| Feature | Standalone behavior |
| --- | --- |
| Upload and examples | Local file selection, drag/drop and clean/error sample loading are preserved. |
| Attribute validation | Required fields must be directly present and nonblank. The interface retains the required-attribute policy. |
| Geometry structure | Supported GeoJSON types, coordinate bounds, dimensionality, line lengths and ring closure are checked locally. |
| Topology findings | JSTS `IsValidOp` evaluates structurally valid geometries in the browser. |
| Review | Accepted/rejected totals, individual findings, source records, record filters and accepted-feature mapping remain interactive. |
| Ownership | Reporter views are scoped to the local demo identity; staff can review all local datasets. |
| Approval | Staff simulation requires at least one valid feature and explicit exclusion acknowledgment when rejected rows exist. |
| Version and export | Accepted features form a stored export snapshot. SHA-256 is calculated from the exact downloaded UTF-8 bytes. |
| Duplicate handling | Canonical source content and attribute policy identify duplicate uploads for the same demo owner. |
| Processing | Validation occurs locally during the import action; interrupted, uncommitted work must be repeated. |

JSTS and the original PostGIS/GEOS build are different geometry engines. Complete numerical and behavioral parity is not claimed. This edition uses planar validity rules for 2D longitude/latitude coordinates; it does not transform coordinate systems, repair geometries or resolve antimeridian topology. A fixed export and digest demonstrate reproducibility, not a protected audit trail. See the [app README](02-data-quality-portal/README.md) for supported geometry types and browser limits.

## 3. Fleet monitor

| Feature | Standalone behavior |
| --- | --- |
| Vehicles and routes | Ten synthetic vehicles retain their route offsets, identities, colors and planned routes. |
| Playback | Start, pause, reset and 1x/2x/4x controls advance browser-generated telemetry. |
| Linked monitoring | Vehicle selection, map locations, route toggle, trails, speed bars and selected-vehicle events remain linked. |
| Geofences | Staff demo roles add rectangular zones and remove zones. Boundary points count as inside. |
| Events | Entry/exit transitions, sequence ordering and bounded histories are preserved locally. |
| Multiple tabs | A Web Lock allows only one same-origin tab to process replay. Other tabs can inspect and control local state. |
| Reopening and handover | A new replay leader pauses saved running state. Retained trails and events remain available; replay requires Start again. |
| Replay reset | Clears telemetry, memberships and events while retaining custom zones and speed. Shared **Reset demo data** restores the entire initial dataset. |

Each replay frame represents ten seconds of simulated travel for speed calculation. Timer ticks are nominally one second and may be throttled or suspended by the browser. Timestamps are actual browser processing times, not simulated clock times. Spherical haversine distances replace PostGIS ellipsoidal distances. Planar JavaScript geofence checks cover the local synthetic examples; they are not a general polar or antimeridian spatial engine. See the [app README](03-fleet-monitor/README.md) for retention limits and coordination behavior.

## 4. Parcel scenario explorer

| Feature | Standalone behavior |
| --- | --- |
| Parcel grid and selection | Twenty-four synthetic parcels, district filtering, map/table selection, select-visible and clear-selection controls remain. |
| Assumptions | Names, floors, coverage, unit area and valid distinct parcel selections are checked locally. |
| Capacity calculation | Gross area, residential efficiency, estimated units, open space and floor-area ratio use the original transparent formulas. |
| Height warnings | Synthetic height-limit comparisons remain warnings for the planning demonstration. |
| Saved scenarios | Scenarios are stored for the selected demo identity; another identity cannot access them through the local adapter. |
| Comparison | Up to four saved results can be compared in unit-capacity and open-space charts. |
| Recalculation | A local recalculation repeats the saved assumptions and increments the result revision. Save a new scenario to compare changed assumptions. |
| Export and deletion | JSON exports retain assumptions, results, parcel geometry snapshots and the disclosed area method. Local scenarios can be deleted. |

The fixed parcel rectangles use the spherical latitude-band formula with mean Earth radius 6,371,008.8 metres. This differs from PostGIS ellipsoidal geography areas, so output totals can differ from full-stack screenshots. Displayed acreage is rounded; calculations use unrounded areas. The method is documented in the [app README](04-parcel-scenarios/README.md) and exported results. It is not a cadastral or permit calculation.

## 5. Infrastructure inspections

| Feature | Standalone behavior |
| --- | --- |
| Cesium scene | Eight synthetic assets retain their scene/register selection, full-corridor view, selected-asset focus and labels. |
| Height display | Actual scale, 3x and 5x drawing exaggeration leave recorded base, height and top measurements unchanged. |
| Asset condition | Open-observation filters, counts and scene colors update from local records. |
| Observation creation | Severity, notes, observed time and demo author are recorded locally. |
| Resolution and reopening | Staff demo roles supply notes for each accepted status change. |
| Stale edit checks | A version number rejects writes made from an outdated observation. |
| History | Actor, action, notes and timestamp are appended to the local observation history. |
| Profile generation | Browser calculations create 71 samples, a chart, a table and summary measurements from the synthetic eight-asset corridor. |
| Snapshots and export | Completed runs retain their source assets. GeoJSON exports contain the calculated samples and method metadata. |

Profile segments follow spherical great circles with a mean radius of 6,371,008.8 metres. Elevations interpolate linearly between synthetic asset base values. This is an actual browser calculation, with a disclosed spherical approximation in place of PostGIS ellipsoidal interpolation. It is not a surveyed surface, DEM or engineering clearance model. See the [app README](05-infrastructure-inspections/README.md) for the interpolation and observation rules.

## Comparing the editions locally

Start the full-stack applications with their existing Rails/database/worker instructions. Start standalone apps separately from this directory. Open the corresponding 517x and 527x ports side by side and use synthetic workflows to compare their behavior.

Records, IDs, timestamps and numerical outputs need not match between editions. Each has separate storage, independently seeded data and, where disclosed above, a different spatial method. Compare feature behavior and the stated calculation assumptions instead of treating matching screenshots as proof of backend parity.

The assembled `standalone/dist` gallery is another static presentation of these browser editions. It does not launch the originals, synchronize their databases or create a public deployment. Tests, browser checks and hosting checks establish separate evidence; this comparison does not claim those checks have all completed.
