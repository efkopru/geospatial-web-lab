import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, useSession, Login, AppShell, Stat, useLive, usePolling } from '@geo/shared';
import CorridorViewer from './CorridorViewer.jsx';
import './inspections.css';

function ProfileChart({ samples, summary }) {
  if (!samples?.length) return null;
  const min = summary.min_ground_m - 5;
  const range = Math.max(10, summary.max_ground_m - min + 5);
  const x = (point) => 48 + point.distance_m / Math.max(1, summary.length_m) * 700;
  const y = (point) => 148 - (point.elevation_m - min) / range * 110;
  const line = samples.map((point) => `${x(point)},${y(point)}`).join(' ');
  return <svg className="inspection-profile-chart" viewBox="0 0 800 185" role="img" aria-label={`Synthetic base elevation profile from ${summary.min_ground_m} to ${summary.max_ground_m} meters over ${Math.round(summary.length_m)} meters`}><line x1="48" x2="748" y1="148" y2="148" stroke="#cbd5e1" /><polygon points={`48,148 ${line} 748,148`} fill="#cfe7df" /><polyline points={line} fill="none" stroke="#337568" strokeWidth="3" /><text x="5" y="30">{summary.max_ground_m} m</text><text x="5" y="147">{summary.min_ground_m} m</text><text x="48" y="175">0 m</text><text x="650" y="175">{Math.round(summary.length_m)} m along corridor</text></svg>;
}

export function InspectionCard({ inspection, staff, onChange }) {
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const stale = editing && draft?.lock_version !== inspection.lock_version;
  const toggleEditing = () => {
    setEditing(!editing); setNotes(''); setError('');
    setDraft({ status: inspection.status, lock_version: inspection.lock_version });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (stale || !draft) return;
    setBusy(true); setError('');
    try {
      await api(`/api/inspections/${inspection.id}`, { method: 'PATCH', body: { inspection: { status: draft.status === 'open' ? 'resolved' : 'open', resolution_notes: notes, lock_version: draft.lock_version } } });
      setEditing(false); setNotes(''); await onChange();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <article className="inspection-card">
    <div className="inspection-card-heading"><span className={`inspection-severity ${inspection.severity}`}>{inspection.severity}</span><span className={`badge ${inspection.status}`}>{inspection.status}</span><time>{new Date(inspection.observed_at).toLocaleDateString()}</time></div>
    <p>{inspection.notes}</p><small>Reported by {inspection.author_name}</small>
    {inspection.resolution_notes && <p className="inspection-resolution"><strong>{inspection.status === 'resolved' ? 'Resolution' : 'Reopening'}:</strong> {inspection.resolution_notes}</p>}
    <details><summary>History ({inspection.events.length})</summary><ol className="inspection-history">{inspection.events.map((event) => <li key={event.id}><strong>{event.action} · {event.actor_name}</strong><time>{new Date(event.created_at).toLocaleString()}</time><p>{event.notes}</p></li>)}</ol></details>
    {staff && <button className="secondary compact" disabled={busy} onClick={toggleEditing}>{editing ? 'Cancel' : inspection.status === 'open' ? 'Resolve observation' : 'Reopen observation'}</button>}
    {editing && <form onSubmit={submit} className="inspection-edit"><label className="field">{draft?.status === 'open' ? 'Resolution notes' : 'Reason for reopening'}<textarea rows="3" minLength="10" maxLength="2000" required value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{stale && <p className="notice error" role="alert">This observation changed while you were editing. Cancel and reopen the form to use the latest status.</p>}{error && <p className="notice error" role="alert">{error}</p>}<button disabled={busy || stale}>{busy ? 'Saving…' : 'Save status change'}</button></form>}
  </article>;
}

export default function App() {
  const session = useSession();
  if (session.loading) return <p className="inspection-loading" role="status">Loading inspection workspace…</p>;
  if (!session.user) return <Login title="Infrastructure inspections" onLogin={session.login} error={session.error} />;
  return <Workspace key={`${session.user.id}:${session.user.role}`} session={session} />;
}

function Workspace({ session }) {
  const [assets, setAssets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [runs, setRuns] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [severity, setSeverity] = useState('medium');
  const [notes, setNotes] = useState('');
  const [exaggeration, setExaggeration] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [focusRequest, setFocusRequest] = useState(null);
  const [filter, setFilter] = useState('all');
  const refreshVersion = useRef(0);
  const detailVersion = useRef(0);
  const observationVersion = useRef(0);
  const selectionRef = useRef(selectedId);
  const mounted = useRef(true);
  selectionRef.current = selectedId;
  const staff = session.user?.role === 'staff';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; refreshVersion.current++; detailVersion.current++; };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || !session.user) return;
    const version = ++refreshVersion.current;
    try {
      const [assetData, runData] = await Promise.all([api('/api/assets'), api('/api/profile_runs')]);
      if (version !== refreshVersion.current) return;
      setAssets(assetData.assets); setRuns(runData.profile_runs);
      setSelectedId((current) => current ?? assetData.assets[0]?.id ?? null);
      setProfileId((current) => current ?? runData.profile_runs[0]?.id ?? null);
    } catch (failure) { if (version === refreshVersion.current) setError(failure.message); }
  }, [session.user]);
  const refreshDetail = useCallback(async () => {
    const assetId = selectionRef.current;
    if (!mounted.current || !assetId || !session.user) return;
    const version = ++detailVersion.current;
    try { const data = await api(`/api/assets/${assetId}`); if (version === detailVersion.current && selectionRef.current === assetId) setDetail(data); }
    catch (failure) { if (version === detailVersion.current) setError(failure.message); }
  }, [session.user]);
  const refreshAll = useCallback(async () => { await Promise.all([refresh(), refreshDetail()]); }, [refresh, refreshDetail]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { observationVersion.current++; setShowForm(false); setNotes(''); refreshDetail(); }, [selectedId, refreshDetail]);
  useLive('InspectionChannel', refreshAll, { viewer: session.user?.id || null });
  usePolling(refreshAll, 6000);
  const selectedRun = runs.find((run) => run.id === profileId);
  useEffect(() => {
    if (!profileId || !session.user) return;
    let canceled = false;
    api(`/api/profile_runs/${profileId}`).then((data) => { if (!canceled) setProfile(data); }).catch((failure) => { if (!canceled) setError(failure.message); });
    return () => { canceled = true; };
  }, [profileId, selectedRun?.status, session.user]);

  const createObservation = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const version = observationVersion.current;
    try {
      await api(`/api/assets/${selectedId}/inspections`, { method: 'POST', body: { inspection: { severity, notes, observed_at: new Date().toISOString() } } });
      if (!mounted.current) return;
      if (version === observationVersion.current) { setNotes(''); setShowForm(false); }
      await refreshAll();
    }
    catch (failure) { if (mounted.current && version === observationVersion.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const toggleObservation = () => { observationVersion.current++; setShowForm(!showForm); };
  const editObservationNotes = (value) => { observationVersion.current++; setNotes(value); };
  const editObservationSeverity = (value) => { observationVersion.current++; setSeverity(value); };
  const createProfile = async (retryId) => {
    setBusy(true); setError('');
    try { const data = await api(retryId ? `/api/profile_runs/${retryId}/retry` : '/api/profile_runs', { method: 'POST', body: {} }); setProfileId(data.profile_run.id); await refresh(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const selected = assets.find((asset) => asset.id === selectedId);
  const selectedDetail = detail?.asset?.id === selectedId ? detail : null;
  const visibleAssets = filter === 'open' ? assets.filter((asset) => asset.open_inspections > 0) : assets;
  const focus = (mode) => setFocusRequest({ mode, at: Date.now() });

  return <AppShell title="Infrastructure inspections" subtitle="A spatial record of asset condition" accent="#496f4b" user={session.user} onLogout={session.logout} actions={<span className="inspection-source">SYNTHETIC CORRIDOR</span>}>
    <div className="inspection-heading"><div><p className="inspection-eyebrow">FIELD OPERATIONS / FOOTHILLS CORRIDOR</p><h1>Inspect in context.</h1><p>Explore asset heights, record observations, and trace each resolution.</p></div><button className="secondary" onClick={() => focus('all')}>View full corridor</button></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className="stat-grid"><Stat label="Corridor assets" value={assets.length} hint="Poles, towers, and cabinets" /><Stat label="Open observations" value={assets.reduce((sum, asset) => sum + asset.open_inspections, 0)} hint="Awaiting staff resolution" /><Stat label="Highest structure" value={`${assets.length ? Math.max(...assets.map((asset) => asset.structure_height_m)) : 0} m`} hint="Height above synthetic base" /><Stat label="Ground elevation range" value={assets.length ? `${Math.min(...assets.map((asset) => asset.ground_elevation_m))}–${Math.max(...assets.map((asset) => asset.ground_elevation_m))} m` : 'No assets'} hint="Synthetic elevation values" /></div>
    <div className="inspection-layout">
      <aside className="panel inspection-assets"><div className="inspection-section-title"><h2>Asset register</h2><span className="badge">{visibleAssets.length}</span></div><label className="field">Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All assets</option><option value="open">With open observations</option></select></label><div className="inspection-asset-list">{visibleAssets.map((asset) => <button key={asset.id} className={`inspection-asset ${selectedId === asset.id ? 'selected' : ''}`} aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)}><span className={`inspection-kind ${asset.kind}`} aria-hidden="true">{asset.kind === 'tower' ? 'T' : asset.kind === 'pole' ? 'P' : 'C'}</span><span><strong>{asset.asset_code}</strong><small>{asset.name}</small></span><span className={`inspection-open ${asset.open_inspections ? 'attention' : ''}`}>{asset.open_inspections || '0'}</span></button>)}</div><p className="inspection-muted">Amber assets have open observations. Select a model or a register row.</p></aside>
      <section className="panel inspection-scene"><div className="inspection-scene-toolbar"><h2>3D corridor</h2><label>Height display<select value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))}><option value="1">1× actual scale</option><option value="3">3× visual exaggeration</option><option value="5">5× visual exaggeration</option></select></label><label><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> Labels</label></div><CorridorViewer assets={assets} selectedId={selectedId} onSelect={setSelectedId} exaggeration={exaggeration} showLabels={showLabels} focusRequest={focusRequest} /><p className="inspection-map-help">Drag to orbit/pan, wheel to zoom, middle-drag to tilt. Local asset surfaces use synthetic elevations. No terrain service or token is required.</p></section>
    </div>
    <div className="grid-two inspection-detail-layout">
      <section className="panel"><div className="inspection-section-title"><div><p className="inspection-eyebrow">SELECTED ASSET</p><h2>{selected?.name || 'Choose an asset'}</h2></div><button className="secondary compact" disabled={!selected} onClick={() => focus('selected')}>Focus in 3D</button></div>{selected && <><dl className="inspection-measurements"><div><dt>Asset / type</dt><dd>{selected.asset_code} / {selected.kind}</dd></div><div><dt>Structure height</dt><dd>{selected.structure_height_m} m above base</dd></div><div><dt>Base elevation</dt><dd>{selected.ground_elevation_m} m</dd></div><div><dt>Top elevation</dt><dd>{selected.top_elevation_m} m</dd></div></dl><div className="inspection-height-note"><strong>Height and elevation describe different measurements.</strong><p>This {selected.structure_height_m} m structure begins at {selected.ground_elevation_m} m and reaches {selected.top_elevation_m} m. Display exaggeration changes only the 3D drawing; these measurements remain unchanged.</p></div><div className="inspection-section-title"><h3>Observation history</h3><button onClick={toggleObservation}>{showForm ? 'Cancel' : 'Add observation'}</button></div>{showForm && <form onSubmit={createObservation} className="inspection-observation-form"><label className="field">Severity<select aria-label="Severity" value={severity} onChange={(event) => editObservationSeverity(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="field">Observation notes<textarea rows="4" minLength="10" maxLength="2000" required value={notes} onChange={(event) => editObservationNotes(event.target.value)} placeholder="Describe the condition and the follow-up needed." /></label><button disabled={busy}>{busy ? 'Saving…' : 'Save observation'}</button></form>}{selectedDetail?.inspections.map((inspection) => <InspectionCard key={inspection.id} inspection={inspection} staff={staff} onChange={refreshAll} />)}{selectedDetail?.inspections.length === 0 && <p className="empty">No observations recorded for this asset.</p>}</>}</section>
      <section className="panel inspection-profile"><div className="inspection-section-title"><div><p className="inspection-eyebrow">BACKGROUND PROCESSING</p><h2>Corridor elevation profile</h2></div><button disabled={busy || selectedRun?.status === 'pending' || selectedRun?.status === 'processing'} onClick={() => createProfile()}>Generate profile</button></div><p className="inspection-muted">A queued job snapshots the asset register and interpolates ground elevations along the corridor. This is synthetic surface data, not a measured DEM.</p>{runs.length > 0 && <label className="field">Profile run<select value={profileId || ''} onChange={(event) => setProfileId(Number(event.target.value))}>{runs.map((run) => <option key={run.id} value={run.id}>Run #{run.id} · {run.status} · {new Date(run.created_at).toLocaleString()}</option>)}</select></label>}{selectedRun && <div className={`inspection-job ${selectedRun.status}`} role="status"><span className="badge">{selectedRun.status}</span><span>{selectedRun.status === 'pending' ? 'Queued for background worker' : selectedRun.status === 'processing' ? 'Computing distances and surface samples' : selectedRun.status === 'completed' ? `${selectedRun.summary.sample_count} samples ready` : selectedRun.error_message}</span></div>}{selectedRun?.status === 'failed' && <button className="secondary" disabled={busy} onClick={() => createProfile(selectedRun.id)}>Retry preprocessing</button>}{selectedRun?.status === 'completed' && profile?.profile_run?.id === selectedRun.id && <><ProfileChart samples={profile.samples} summary={selectedRun.summary} /><dl className="inspection-measurements"><div><dt>Corridor length</dt><dd>{Math.round(selectedRun.summary.length_m)} m</dd></div><div><dt>Highest asset top</dt><dd>{selectedRun.summary.max_top_m} m</dd></div></dl><a className="inspection-download" href={`/api/profile_runs/${selectedRun.id}/download`}>Download profile GeoJSON</a><details><summary>Profile samples</summary><div className="table-wrap inspection-samples"><table><thead><tr><th>Distance, m</th><th>Synthetic elevation, m</th></tr></thead><tbody>{profile.samples.map((sample, index) => <tr key={index}><td>{sample.distance_m.toFixed(1)}</td><td>{sample.elevation_m.toFixed(1)}</td></tr>)}</tbody></table></div></details></>}{!runs.length && <div className="inspection-profile-empty"><div className="inspection-profile-line" /><h3>Read the corridor from end to end.</h3><p>Generate a profile to compare synthetic base elevations and export all samples with their source metadata.</p></div>}</section>
    </div>
  </AppShell>;
}
