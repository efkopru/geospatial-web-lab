import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useSession, Login, AppShell, GeoMap, Stat, BarChart, useLive, usePolling } from '@geo/shared';
import './fleet.css';

const INITIAL = { vehicles: [], geofences: [], events: [], replay: { running: false, cursor: 0, sequence: 0, speed: 1 } };
const formatTime = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Awaiting telemetry';

export default function App() {
  const session = useSession();
  if (session.loading) return <div className="fleet-loading" role="status">Opening local fleet data…</div>;
  if (!session.user) return <Login title="Fleet monitor" onLogin={session.login} error={session.error} />;
  return <Workspace key={`${session.user.id}:${session.user.role}`} session={session} />;
}

function Workspace({ session }) {
  const [fleet, setFleet] = useState(INITIAL);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showRoute, setShowRoute] = useState(true);
  const [eventFilter, setEventFilter] = useState('all');
  const [fenceForm, setFenceForm] = useState(false);
  const [bounds, setBounds] = useState({ name: '', west: '-96.810', south: '32.780', east: '-96.800', north: '32.790' });
  const stateRequest = useRef(0);
  const historyRequest = useRef(0);
  const mounted = useRef(true);
  const staff = session.user?.role === 'staff';

  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the counters on unmount invalidates requests still in flight
    return () => { mounted.current = false; stateRequest.current++; historyRequest.current++; };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || !session.user) return;
    const requestId = ++stateRequest.current;
    try {
      const data = await api('/api/fleet');
      if (requestId !== stateRequest.current) return;
      setFleet(data);
      setSelectedId((current) => current ?? data.vehicles[0]?.id ?? null);
      setLoaded(true);
      setError('');
    } catch (failure) { if (requestId === stateRequest.current) setError(failure.message); }
  }, [session.user]);

  useEffect(() => { refresh(); }, [refresh]);
  useLive('ReplayChannel', refresh, { viewer: session.user?.id || null });
  usePolling(refresh, 5000);

  useEffect(() => {
    if (!selectedId || !session.user) return;
    const requestId = ++historyRequest.current;
    api(`/api/vehicles/${selectedId}/history`).then((data) => {
      if (requestId === historyRequest.current) setHistory(data);
    }).catch((failure) => { if (requestId === historyRequest.current) setError(failure.message); });
  }, [selectedId, fleet.replay.sequence, fleet.replay.generation, session.user]);

  const control = async (action_name, speed) => {
    setBusy(true); setError('');
    try { await api('/api/fleet/control', { method: 'POST', body: { action_name, speed } }); await refresh(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const createFence = async (event) => {
    event.preventDefault();
    const { west, south, east, north } = Object.fromEntries(Object.entries(bounds).filter(([key]) => key !== 'name').map(([key, value]) => [key, Number(value)]));
    if (!(west < east && south < north && west >= -180 && east <= 180 && south >= -90 && north <= 90)) {
      setError('Enter valid bounds with west below east and south below north.'); return;
    }
    setBusy(true);
    try {
      await api('/api/geofences', { method: 'POST', body: { geofence: { name: bounds.name, color: '#6366f1', coordinates: [[west, south], [east, south], [east, north], [west, north], [west, south]] } } });
      setFenceForm(false); setBounds((current) => ({ ...current, name: '' })); await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const deleteFence = async (id) => {
    setBusy(true);
    try { await api(`/api/geofences/${id}`, { method: 'DELETE' }); await refresh(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const selected = fleet.vehicles.find((vehicle) => vehicle.id === selectedId);
  const selectedHistory = history?.vehicle?.id === selectedId ? history : null;
  const activeVehicles = fleet.vehicles.filter((vehicle) => vehicle.longitude != null);
  const insideCount = fleet.vehicles.filter((vehicle) => vehicle.inside_geofences.length > 0).length;
  const events = fleet.events.filter((event) => eventFilter === 'all' || event.vehicle_id === selectedId);
  // Rebuilt only when fleet data, the selection or the route toggle change; other state, such
  // as typing a zone name, would otherwise redraw every map graphic.
  const mapFeatures = useMemo(() => {
    const vehicle = fleet.vehicles.find((item) => item.id === selectedId);
    const features = fleet.geofences.map((fence) => ({ type: 'Feature', id: `fence-${fence.id}`, properties: { id: `fence-${fence.id}`, title: fence.name, color: fence.color, kind: 'geofence' }, geometry: { type: 'Polygon', coordinates: [fence.coordinates] } }));
    if (showRoute && selectedHistory?.route?.length > 1) features.push({ type: 'Feature', id: 'planned-route', properties: { id: 'planned-route', title: `${vehicle?.name} planned route`, color: '#64748b', kind: 'route' }, geometry: { type: 'LineString', coordinates: [...selectedHistory.route, selectedHistory.route[0]] } });
    if (selectedHistory?.points?.length > 1) features.push({ type: 'Feature', id: 'history-route', properties: { id: 'history-route', title: `${vehicle?.name} recent trail`, color: vehicle?.color || '#06b6d4', kind: 'trail' }, geometry: { type: 'LineString', coordinates: selectedHistory.points.map((point) => [point.longitude, point.latitude]) } });
    fleet.vehicles.filter((item) => item.longitude != null).forEach((item) => features.push({ type: 'Feature', id: `vehicle-${item.id}`, properties: { id: `vehicle-${item.id}`, vehicleId: item.id, title: `${item.name} · ${item.speed_kph.toFixed(0)} km/h`, color: item.color, kind: 'vehicle' }, geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] } }));
    return { type: 'FeatureCollection', features };
  }, [fleet, selectedId, selectedHistory, showRoute]);

  return <AppShell title="Fleet monitor" subtitle="Browser replay, routes, and zone transitions" accent="#06b6d4" user={session.user} onLogout={session.logout} actions={<span className="fleet-simulation">LOCAL SIMULATION</span>}>
    <div className="fleet-heading"><div><p className="fleet-eyebrow">STANDALONE / DALLAS DEMO</p><h1>Every vehicle. One view.</h1><p>Ten synthetic vehicles on looping routes. Browser processing and local storage.</p></div><div className="fleet-status"><span className={`fleet-dot ${fleet.replay.running ? 'running' : ''}`} />{fleet.replay.running ? 'Replay running' : 'Replay paused'}</div></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {!loaded && <div className="notice" role="status">Loading fleet state…</div>}
    {loaded && fleet.replay.available === false && <div className="notice" role="status">{fleet.replay.reason}</div>}
    <div className="stat-grid">
      <Stat label="Vehicles reporting" value={`${activeVehicles.length} / ${fleet.vehicles.length}`} hint="Synthetic telemetry" />
      <Stat label="Inside a geofence" value={insideCount} hint={`${fleet.geofences.length} monitored zones`} />
      <Stat label="Average speed" value={`${activeVehicles.length ? Math.round(activeVehicles.reduce((sum, vehicle) => sum + vehicle.speed_kph, 0) / activeVehicles.length) : 0} km/h`} hint="Spherical route distance estimate" />
      <Stat label="Replay frame" value={fleet.replay.cursor} hint={`${fleet.replay.speed}× multiplier · 10 simulated seconds per frame`} />
    </div>
    <section className="panel fleet-controls" aria-label="Replay controls">
      <div className="toolbar"><button className="button" disabled={!staff || busy || fleet.replay.running || fleet.replay.available === false} onClick={() => control('start')}>Start replay</button><button className="button secondary" disabled={!staff || busy || !fleet.replay.running} onClick={() => control('pause')}>Pause</button><button className="button secondary" disabled={!staff || busy} onClick={() => control('reset')}>Reset replay</button><label className="fleet-inline-label">Speed<select aria-label="Replay speed" value={fleet.replay.speed} disabled={!staff || busy} onChange={(event) => control('speed', Number(event.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div>
      <p className="fleet-muted">{staff ? 'Reset clears telemetry and events while keeping zones. One browser tab processes replay; reopening or changing the processing tab pauses it.' : 'Simulated observer role. Choose staff to control replay or edit zones.'}</p><p className="fleet-muted">One timer tick advances 1, 2, or 4 frames. Background tabs can slow down. Timestamps show browser processing time, not a simulated clock.</p>
    </section>
    <div className="fleet-workspace">
      <section className="panel fleet-list" aria-label="Vehicle list"><div className="fleet-section-title"><h2>Vehicles</h2><span className="badge">{fleet.vehicles.length} units</span></div><div className="fleet-vehicle-scroll">{fleet.vehicles.map((vehicle) => <button key={vehicle.id} className={`fleet-vehicle ${selectedId === vehicle.id ? 'selected' : ''}`} aria-pressed={selectedId === vehicle.id} onClick={() => setSelectedId(vehicle.id)}><span className="fleet-vehicle-color" style={{ background: vehicle.color }} /><span><strong>{vehicle.name}</strong><small>{vehicle.registration} · {vehicle.inside_geofences.length ? 'Inside zone' : 'Outside zones'}</small></span><span className="fleet-speed">{vehicle.longitude == null ? 'Pending' : `${Math.round(vehicle.speed_kph)} km/h`}</span></button>)}</div></section>
      <section className="panel fleet-map-panel" aria-label="Fleet positions map"><div className="fleet-section-title"><h2>Live map</h2><label className="fleet-inline-label"><input type="checkbox" checked={showRoute} onChange={(event) => setShowRoute(event.target.checked)} /> Planned route</label></div><GeoMap features={mapFeatures} center={[-96.801, 32.779]} zoom={12} selectedId={`vehicle-${selectedId}`} onSelect={(feature) => { if (feature?.properties?.vehicleId) setSelectedId(Number(feature.properties.vehicleId)); }} /><p className="fleet-map-note">Polygons show geofences. Colored lines show recorded telemetry; gray shows the selected vehicle’s planned route.</p></section>
    </div>
    <div className="grid-two fleet-lower">
      <section className="panel"><div className="fleet-section-title"><h2>{selected?.name || 'Vehicle'} telemetry</h2><span className="badge">{selected?.registration || 'Select a vehicle'}</span></div>{selected ? <><dl className="fleet-telemetry"><div><dt>Last observed</dt><dd>{formatTime(selected.captured_at)}</dd></div><div><dt>Longitude / latitude</dt><dd>{selected.longitude == null ? 'No fix yet' : `${selected.longitude.toFixed(5)}, ${selected.latitude.toFixed(5)}`}</dd></div><div><dt>Sequence</dt><dd>{selected.last_sequence < 0 ? 'Pending' : selected.last_sequence}</dd></div><div><dt>Recorded trail</dt><dd>{selectedHistory?.points?.length || 0} / {fleet.history_limit || 360} points</dd></div></dl><h3>Recent speed, km/h</h3>{selectedHistory?.points?.length ? <BarChart items={selectedHistory.points.slice(-12).map((point) => ({ label: `#${point.sequence}`, value: Math.round(point.speed_kph) }))} color={selected.color} /> : <p className="empty">Start replay to record telemetry and a speed history.</p>}</> : <p className="empty">No vehicles have been seeded.</p>}</section>
      <section className="panel"><div className="fleet-section-title"><h2>Geofences</h2><button className="button secondary" disabled={!staff || busy} onClick={() => setFenceForm(!fenceForm)} aria-expanded={fenceForm}>{fenceForm ? 'Cancel' : 'Add zone'}</button></div><p className="fleet-muted">Boundary points count as inside. Events appear only when membership changes.</p>{fenceForm && <form onSubmit={createFence} className="fleet-zone-form"><label className="field">Zone name<input value={bounds.name} maxLength="80" required onChange={(event) => setBounds({ ...bounds, name: event.target.value })} /></label><div className="fleet-bounds">{['west', 'south', 'east', 'north'].map((key) => <label className="field" key={key}>{key[0].toUpperCase() + key.slice(1)}<input type="number" step="0.00001" value={bounds[key]} required onChange={(event) => setBounds({ ...bounds, [key]: event.target.value })} /></label>)}</div><button className="button" disabled={busy}>Create rectangular zone</button></form>}<ul className="fleet-zones">{fleet.geofences.map((fence) => <li key={fence.id}><span className="fleet-vehicle-color" style={{ background: fence.color }} /><div><strong>{fence.name}</strong><small>{fleet.vehicles.filter((vehicle) => vehicle.inside_geofences.includes(fence.id)).length} vehicles inside</small></div><button className="button secondary" disabled={!staff || busy} onClick={() => deleteFence(fence.id)} aria-label={`Remove ${fence.name}`}>Remove</button></li>)}</ul>{!fleet.geofences.length && <p className="empty">Add a zone to detect entry and exit transitions.</p>}</section>
    </div>
    <section className="panel fleet-events"><div className="fleet-section-title"><div><h2>Zone event chronology</h2><p className="fleet-muted">Latest 100 transitions displayed; at most {fleet.event_limit || 500} retained.</p></div><label className="fleet-inline-label">Filter<select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">All vehicles</option><option value="selected">Selected vehicle</option></select></label></div><div className="table-wrap"><table><thead><tr><th>Time</th><th>Vehicle</th><th>Transition</th><th>Geofence</th><th>Sequence</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{formatTime(event.captured_at)}</td><td><button className="fleet-link" onClick={() => setSelectedId(event.vehicle_id)}>{event.vehicle_name}</button></td><td><span className={`badge fleet-event-${event.transition}`}>{event.transition}</span></td><td>{event.geofence_name}</td><td>#{event.sequence}</td></tr>)}</tbody></table></div>{!events.length && <p className="empty">No transitions yet. Start replay and watch vehicles cross zone boundaries.</p>}</section>
  </AppShell>;
}
