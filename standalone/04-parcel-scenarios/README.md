# Standalone parcel scenario explorer

This browser edition preserves the parcel selection, planning formulas, saved comparisons and exports from the full-stack learning app. It uses synthetic data and IndexedDB through the shared standalone runtime. No Rails API, PostGIS database or worker runs in this edition.

Follow the [suite setup instructions](../README.md). From `standalone`, `npm run dev:4` starts this app at [127.0.0.1:5274](http://127.0.0.1:5274/). The combined launcher also starts the comparison gallery. The original full-stack UI remains on port 5174.

## Features

- Browse 24 synthetic parcels in two districts. Select them on the map or in the table, select all visible parcels, or clear the selection. Changing districts does not silently discard an existing selection.
- Set a name, 1 to 30 floors, 5% to 80% coverage and a 400 to 3,000 square-foot unit area. Invalid, repeated and unknown parcel IDs are rejected.
- Calculate gross floor area, residential floor area, estimated units, open space, floor-area ratio and synthetic height-limit warnings immediately in the browser.
- Save scenarios for the selected demo user, up to 1,000 saved scenarios per user in this browser. Delete your own scenarios to save more; other users' scenarios do not count toward your limit. Seeded examples belong to Alex Morgan. Switching to another user changes the visible scenario collection.
- Compare up to four completed scenarios using unit-capacity and open-space charts.
- Recalculate a saved scenario with its existing assumptions. This browser action increments its calculation revision. Save another scenario to compare different assumptions.
- Download a JSON export containing assumptions, calculated results, geometry snapshots, area method and synthetic-data provenance. Delete unwanted local scenarios.
- Use the shared browser controls to export or restore a backup, or reset local demo data.

## Spatial and numerical method

The bundled rectangles reproduce the synthetic 6 by 4 parcel grid around Dallas. Their fixed boundaries are meridians and parallels. Areas are calculated as:

```text
area_m2 = R² × radians(east − west) × (sin(north) − sin(south))
R = 6,371,008.8 metres
site_sqft = sum(area_m2) × 10.76391041671
gross_floor_area = site_sqft × coverage × floors
residential_area = gross_floor_area × 0.8
units = floor(residential_area / unit_area)
open_space = site_sqft × (1 − coverage)
floor_area_ratio = coverage × floors
```

Sines receive angles in radians. Displayed acres round to two decimal places; calculations retain unrounded areas. Exports preserve each source rectangle and its area rounded to three decimal places. This mean-radius spherical area differs from the original app's PostGIS ellipsoidal geography area. It is suitable for the synthetic demonstration and is not a cadastral measurement or permit decision. The rectangle formula is not presented as a general polygon validator or area algorithm.

## Boundaries

Demo-user ownership is enforced by the local adapter to demonstrate application behavior. It is not authentication or a security boundary: a person controlling the browser can inspect its storage. There is no shared database, durable background queue or collaboration across devices. The original full-stack edition remains the implementation of those backend features.

ArcGIS SDK assets and basemaps require a network connection. Local records and calculations do not require an application server. Browser clearing or private browsing can remove local records; the shared backup export preserves an inspectable JSON archive that the shared restore control can load again.

## Tests

From the repository root, run `node --test standalone/tests/parcels.test.js`. Tests cover numerical behavior, area assumptions, geometry snapshots, user ownership, recalculation, export, deletion, invalid inputs and read-only route behavior.
