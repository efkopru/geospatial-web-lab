# Fleet Monitor: standalone browser edition

This is a separate browser application. The original Rails application remains in `../../03-fleet-monitor/`. It uses the same ten synthetic Dallas vehicles, route coordinates, default geofences, and interface, with browser processing replacing Rails, Sidekiq, PostGIS, and Action Cable.

## Start and use

Use the commands and ports in the [standalone suite README](../README.md). Open through localhost or HTTPS. File URLs are unsupported. Choose a simulated staff role to control replay and zones; the reporter role can inspect the same local data. Role selection demonstrates UI permissions and provides no authentication or protection against browser developer tools.

1. Select a vehicle to see its planned route. Toggle the planned route checkbox to hide it.
2. Start replay. One timer tick, nominally every second, advances one frame at 1x, two at 2x, or four at 4x. Every frame represents ten seconds of travel for the speed calculation. The map, vehicle list, summary cards, speed chart, and event chronology update from locally persisted data.
3. Select a vehicle on the map, in the list, or through an event row. Its recorded trail and last twelve speed measurements appear with the last observed time, coordinates, sequence, and retained point count.
4. Add a named rectangular zone by specifying west, south, east, and north bounds. A point on an edge or vertex counts as inside. Membership is evaluated on the next telemetry sample; creating a zone does not retroactively change history.
5. Filter the latest 100 events to the selected vehicle or all vehicles. An event is recorded only when membership changes, including the first recorded point inside a zone.
6. Pause to inspect a frame. Reset replay to clear telemetry, membership, and events while retaining custom zones and the speed setting. Removing a zone also removes its memberships and associated events.
7. Use the shared backup control to download JSON. Automatic restoration/import of backup files is not implemented. The shared reset control restores the entire application's original synthetic state, including default zones.

## Preserved behavior

- Ten independently offset looping routes, stable vehicle identities, colors, and registrations.
- Start, pause, reset, and 1x/2x/4x controls, vehicle selection, route toggle, speed bars, map trails, and event filtering.
- Staff simulation checks for controls, zone mutations, and the manual telemetry adapter operation.
- Monotonic per-vehicle telemetry sequence numbers: duplicate and out-of-order records do not alter history. Manual telemetry is rejected while replay runs.
- At most 360 points per vehicle and 500 events overall; the UI displays the newest 100 events.
- Closed polygon validation, positive area, valid coordinates, self-intersection rejection, and boundary-inclusive point membership.
- IndexedDB persistence and local cross-tab updates provided by the standalone shared runtime.

## Differences from the full-stack application

| Area | Standalone browser behavior |
|---|---|
| Processing | A browser timer replaces durable background jobs. Background tabs may be throttled or suspended. Closed browsers do no work. Missed time is not replayed automatically. |
| Multiple tabs | Exactly one same-origin tab holds a Web Lock and processes replay. Other tabs can inspect and control shared local state. When the processing tab closes and leadership changes, replay pauses. |
| Browser support | Playback requires Web Locks, available in supported browsers on localhost or HTTPS. Unsupported coordination disables playback with an explanation; it does not start competing timers. |
| Reopening | A newly acquired replay leader pauses persisted running state. Trails and events remain saved. Press Start replay to resume. The shared runtime reloads a page restored from the browser back/forward cache to reinitialize its local connections. |
| Timestamps | Timestamps are browser processing times. They are not simulated timestamps and depend on the device clock. |
| Speed | Haversine spherical distance with mean Earth radius 6,371,008.8 m replaces PostGIS spheroidal geography distance. Speed remains capped at 250 km/h. Small numerical differences are expected. |
| Geofences | JavaScript checks planar longitude/latitude rings with boundary inclusion. This is suitable for the local synthetic routes; it is not a general replacement for PostGIS topology or antimeridian/polar analysis. |
| Data and roles | State belongs to this browser profile and origin. Roles are simulated. There is no multi-user server, central telemetry receiver, or secure authorization. |
| Maps | The shared map implementation determines whether network basemaps are available. The local fleet simulation itself does not require a backend. |

## Verification

`../tests/fleet.test.js` checks route seeding and read purity, polygon geometry, distance calculations, replay speed and reset, monotonic telemetry, event transitions, history limits, zone cleanup, simulated role restrictions, manual telemetry conflicts, exclusive replay across two tabs, leadership handover, reopening paused, cleanup, and unsupported-coordination behavior. Run the standalone suite's Node tests from its README.

All routes, vehicles, telemetry, geofences, and events in this edition are synthetic portfolio data.
