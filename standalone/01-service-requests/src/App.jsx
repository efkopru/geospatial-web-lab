import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useSession, AppShell, Login, GeoMap, BarChart, Stat, useLive, usePolling } from '@geo/shared';
import './service.css';

const STATUS = { new: 'New', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved' };
const COLORS = { new: '#dc7c2f', assigned: '#5368c5', in_progress: '#138a83', resolved: '#698663' };
const TRANSITIONS = { new: ['assigned'], assigned: ['in_progress'], in_progress: ['resolved', 'assigned'], resolved: ['in_progress'] };
const CATEGORIES = ['roads', 'lighting', 'drainage', 'parks'];
const EMPTY_FILTER = { q: '', status: '', category: '', radius_m: '', latitude: '33.045', longitude: '-96.995' };
const INITIAL_ISSUE = { title: '', description: '', category: 'roads', latitude: '33.045', longitude: '-96.995' };
const SAMPLE = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-96.9948, 33.0455] }, properties: { title: 'Sample sidewalk repair', category: 'roads', description: 'Synthetic imported request.' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-96.9917, 33.0473] }, properties: { title: 'Sample park light', category: 'lighting' } }
] };

function Status({ value }) { return <span className={`badge sr-status sr-status-${value}`}><span aria-hidden="true" />{STATUS[value] || value}</span>; }
function date(value) { return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet'; }
function message(error) { return error?.message || 'The request could not be completed.'; }

function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="sr-modal" ref={ref} onCancel={onClose} aria-labelledby="modal-title">
    <div className="sr-section-head"><h2 id="modal-title">{title}</h2><button className="secondary" onClick={onClose} aria-label="Close dialog">Close</button></div>
    {children}
  </dialog>;
}

function CreateRequest({ onClose, onCreated }) {
  const [draft, setDraft] = useState(INITIAL_ISSUE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { const result = await api('/api/issues', { method: 'POST', body: { issue: draft } }); onCreated(result.issue); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <Modal title="Report a service request" onClose={onClose}>
    <p className="muted">Add a synthetic issue to the operations map. Coordinates use WGS 84 decimal degrees.</p>
    <form onSubmit={submit} className="sr-form">
      <label className="field">Title<input required maxLength={160} autoFocus value={draft.title} onChange={change('title')} placeholder="e.g. Broken streetlight on Oak Street" /></label>
      <label className="field">Category<select aria-label="Category" value={draft.category} onChange={change('category')}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      <label className="field">Description<textarea rows={4} maxLength={5000} value={draft.description} onChange={change('description')} placeholder="Describe the location and work needed" /></label>
      <div className="grid-two"><label className="field">Latitude<input type="number" min="-90" max="90" step="any" required value={draft.latitude} onChange={change('latitude')} /></label><label className="field">Longitude<input type="number" min="-180" max="180" step="any" required value={draft.longitude} onChange={change('longitude')} /></label></div>
      {error && <p className="notice sr-error" role="alert">{error}</p>}
      <button className="button" disabled={busy}>{busy ? 'Saving request…' : 'Create request'}</button>
    </form>
  </Modal>;
}

function RequestDetail({ issue, staff, isStaff, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(issue ? { status: issue.status, assigned_to_id: issue.assigned_to?.id || '', lock_version: issue.lock_version } : null);
    setError('');
  }, [issue?.id]);
  if (!issue) return <aside className="panel sr-detail"><div className="empty"><h2>Select a request</h2><p>Choose a marker or table row to inspect its details.</p></div></aside>;
  const stale = draft && draft.lock_version !== issue.lock_version;
  const reset = () => { setDraft({ status: issue.status, assigned_to_id: issue.assigned_to?.id || '', lock_version: issue.lock_version }); setError(''); };
  const save = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: { issue: draft } });
      setDraft({ status: result.issue.status, assigned_to_id: result.issue.assigned_to?.id || '', lock_version: result.issue.lock_version });
      onSaved(result.issue);
    } catch (err) { setError(message(err)); onSaved(); } finally { setBusy(false); }
  };
  return <aside className="panel sr-detail">
    <div className="sr-section-head"><span className="sr-eyebrow">REQUEST #{String(issue.id).padStart(4, '0')}</span><Status value={issue.status} /></div>
    <h2>{issue.title}</h2><p className="sr-description">{issue.description || 'No description provided.'}</p>
    <dl className="sr-facts"><div><dt>Category</dt><dd className="sr-capital">{issue.category}</dd></div><div><dt>Reported by</dt><dd>{issue.reporter.name}</dd></div><div><dt>Assigned to</dt><dd>{issue.assigned_to?.name || 'Unassigned'}</dd></div><div><dt>Created</dt><dd>{date(issue.created_at)}</dd></div><div><dt>Updated</dt><dd>{date(issue.updated_at)}</dd></div><div><dt>Coordinates</dt><dd>{issue.latitude.toFixed(5)}, {issue.longitude.toFixed(5)}</dd></div>{issue.resolved_at && <div><dt>Resolved</dt><dd>{date(issue.resolved_at)}</dd></div>}</dl>
    {isStaff && draft && <form className="sr-form sr-assignment" onSubmit={save}>
      <h3>Manage request</h3>
      {stale && <div className="notice" role="status">This request changed while you were viewing it. <button type="button" className="sr-link" onClick={reset}>Load current values</button> before saving.</div>}
      <label className="field">Staff member<select aria-label="Staff member" required value={draft.assigned_to_id} onChange={e => setDraft({ ...draft, assigned_to_id: e.target.value, status: draft.status === 'new' ? 'assigned' : draft.status })}><option value="">Choose a staff member</option>{staff.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
      <label className="field">Status<select aria-label="Status" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{[issue.status, ...TRANSITIONS[issue.status]].map(s => <option key={s} value={s}>{STATUS[s]}</option>)}</select></label>
      {error && <p role="alert" className="notice sr-error">{error}</p>}
      <button className="button" disabled={busy || stale}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>}
  </aside>;
}

function DataTools({ imports, exports, refresh, onError }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const fileRef = useRef(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setFeedback('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a GeoJSON file smaller than 2 MB.');
      const geojson = JSON.parse(await file.text());
      if (!mounted.current) return;
      const result = await api('/api/import_runs', { method: 'POST', body: { geojson } });
      if (!mounted.current) return;
      setFeedback(result.reused ? `Import #${result.import.id} already exists. No duplicate requests were created.` : `Import #${result.import.id} validated locally.`);
      await refresh();
    } catch (err) { if (mounted.current) onError(message(err)); } finally { if (mounted.current) { setBusy(false); if (fileRef.current) fileRef.current.value = ''; } }
  };
  const retry = async (id) => { try { await api(`/api/import_runs/${id}/retry`, { method: 'POST' }); await refresh(); } catch (err) { onError(message(err)); } };
  const createExport = async () => { setBusy(true); try { await api('/api/export_runs', { method: 'POST' }); await refresh(); } catch (err) { onError(message(err)); } finally { setBusy(false); } };
  const sample = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(SAMPLE, null, 2)], { type: 'application/geo+json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'sample-service-requests.geojson'; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="grid-two sr-tools">
    <section className="panel"><span className="sr-eyebrow">BROWSER PROCESSING</span><h2>Import requests</h2><p className="muted">Upload 1 to 500 GeoJSON Point features. Each needs a title and a category: roads, lighting, drainage, or parks. Valid records are imported; rejected rows are listed for correction.</p>
      <div className="sr-drop"><label className="field">GeoJSON file<input ref={fileRef} type="file" accept=".json,.geojson,application/json,application/geo+json" disabled={busy} onChange={e => upload(e.target.files[0])} /></label><button className="secondary" onClick={sample}>Download example</button></div>
      {feedback && <p className="notice" role="status">{feedback}</p>}
      <h3>Recent imports</h3>{imports.length === 0 && <p className="empty">No imports yet.</p>}
      {imports.map(run => <article className="sr-job" key={run.id}><div className="sr-section-head"><strong>Import #{run.id}</strong><span className="badge">{run.status}</span></div><p>{run.imported_count} imported · {run.errors.length} rejected · {run.processed_count}/{run.total_count} processed</p><progress max={run.total_count || 1} value={run.processed_count} aria-label={`Import ${run.id} progress`} /><small>{date(run.created_at)}</small>{run.failure && <p className="sr-error">{run.failure}</p>}{run.status === 'failed' && <button className="secondary" onClick={() => retry(run.id)}>Retry import</button>}{run.errors.length > 0 && <details><summary>Review rejected rows ({run.errors.length})</summary><ul>{run.errors.map((error, i) => <li key={i}>Row {error.row}: {error.message}</li>)}</ul></details>}</article>)}
    </section>
    <section className="panel"><span className="sr-eyebrow">PORTABLE REPORTS</span><h2>Export service requests</h2><p className="muted">Generate a CSV of all requests, including assignments and coordinates. The browser creates a saved CSV snapshot immediately. Exports contain all records, regardless of map filters.</p><button className="button" disabled={busy} onClick={createExport}>Generate CSV report</button><h3 className="sr-spaced">Recent reports</h3>{exports.length === 0 && <p className="empty">No reports yet.</p>}{exports.map(run => <article key={run.id} className="sr-job"><div className="sr-section-head"><strong>Report #{run.id}</strong><span className="badge">{run.status}</span></div><p>{run.record_count} requests · {date(run.created_at)}</p>{run.status === 'completed' && <a className="button secondary" href={`/api/export_runs/${run.id}/download`}>Download CSV</a>}{run.failure && <p className="sr-error">{run.failure}</p>}</article>)}</section>
  </div>;
}

function Workspace({ user, logout }) {
  const [data, setData] = useState({ issues: [], counts: {}, total_count: 0 });
  const [filters, setFilters] = useState(EMPTY_FILTER);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [staff, setStaff] = useState([]);
  const [imports, setImports] = useState([]);
  const [exports, setExports] = useState([]);
  const [tab, setTab] = useState('requests');
  const [showCreate, setShowCreate] = useState(false);
  const [showDistance, setShowDistance] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestSequence.current += 1; }; }, []);
  const isStaff = user.role === 'staff';
  useEffect(() => { const timer = setTimeout(() => setFilters(f => ({ ...f, q: search })), 250); return () => clearTimeout(timer); }, [search]);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const sequence = ++requestSequence.current;
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value && (!['latitude', 'longitude'].includes(key) || filters.radius_m)) query.set(key, value);
      }
      const result = await api(`/api/issues?${query}`);
      if (!mounted.current || sequence !== requestSequence.current) return;
      setData(result); setLoading(false);
      if (isStaff) {
        const [importResult, exportResult] = await Promise.all([api('/api/import_runs'), api('/api/export_runs')]);
        if (sequence === requestSequence.current) { setImports(importResult.imports); setExports(exportResult.exports); }
      }
    } catch (err) { if (sequence === requestSequence.current) { setError(message(err)); setLoading(false); } }
  }, [filters, isStaff]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (isStaff) api('/api/staff').then(result => setStaff(result.staff)).catch(err => setError(message(err))); }, [isStaff]);
  const live = useLive('RequestUpdatesChannel', refresh);
  usePolling(refresh, 15000);
  const issues = data.issues;
  const selected = issues.find(issue => String(issue.id) === String(selectedId));
  const features = useMemo(() => ({ type: 'FeatureCollection', features: issues.map(issue => ({ type: 'Feature', id: issue.id, geometry: { type: 'Point', coordinates: [issue.longitude, issue.latitude] }, properties: { id: issue.id, title: issue.title, label: issue.title, category: issue.category, status: issue.status, color: COLORS[issue.status] } })) }), [issues]);
  const select = (value) => setSelectedId(typeof value === 'object' ? value?.properties?.id ?? value?.attributes?.id ?? value?.id : value);
  const save = (issue) => { if (issue) setData(previous => ({ ...previous, issues: previous.issues.map(old => old.id === issue.id ? issue : old) })); refresh(); };
  return <AppShell title="Civic Works" subtitle="SERVICE REQUEST OPERATIONS" accent="#16786f" user={user} onLogout={logout} actions={<button className="button" onClick={() => setShowCreate(true)}>+ New request</button>}>
    <div className="sr-intro"><div><span className="sr-eyebrow">LEWISVILLE DEMO · SYNTHETIC DATA</span><h1>A clearer view of community work.</h1><p className="muted">{isStaff ? 'Coordinate requests, assign your team, and follow every issue through resolution.' : 'Track your reported issues and see their latest progress.'}</p></div><div className="sr-live"><span style={!live ? { background: '#b48035' } : undefined} />{live ? 'Local updates active' : 'Local updates unavailable'} · saved in this browser</div></div>
    {error && <div role="alert" className="notice sr-error sr-section-head"><span>{error}</span><button className="secondary" onClick={() => { setError(''); refresh(); }}>Retry</button></div>}
    <div className="stat-grid"><Stat label="Matching requests" value={data.total_count} hint={isStaff ? 'Across all reporters' : 'Your requests'} /><Stat label="Awaiting assignment" value={data.counts.new || 0} hint="Ready for triage" /><Stat label="Active work" value={(data.counts.assigned || 0) + (data.counts.in_progress || 0)} hint="Assigned or in progress" /><Stat label="Resolved" value={data.counts.resolved || 0} hint="Within current filters" /></div>
    <nav className="sr-tabs" aria-label="Workspace views"><button aria-current={tab === 'requests' ? 'page' : undefined} onClick={() => setTab('requests')}>Request workspace</button>{isStaff && <button aria-current={tab === 'data' ? 'page' : undefined} onClick={() => setTab('data')}>Imports & reports</button>}</nav>
    {tab === 'data' ? <DataTools imports={imports} exports={exports} refresh={refresh} onError={setError} /> : <>
      <section className="panel sr-filter-panel"><div className="toolbar"><label className="field sr-search">Search requests<input type="search" placeholder="Search title or description" value={search} onChange={e => setSearch(e.target.value)} /></label><label className="field">Status<select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option>{Object.entries(STATUS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field">Category<select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}><option value="">All categories</option>{CATEGORIES.map(value => <option value={value} key={value}>{value}</option>)}</select></label><button className="secondary" aria-expanded={showDistance} onClick={() => setShowDistance(!showDistance)}>Distance filter{filters.radius_m ? ' • Active' : ''}</button><button className="sr-link" onClick={() => { setFilters(EMPTY_FILTER); setSearch(''); }}>Reset</button></div>
        {showDistance && <form className="toolbar sr-distance" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); setFilters({ ...filters, latitude: form.get('latitude'), longitude: form.get('longitude'), radius_m: form.get('radius_m') }); }}><label className="field">Center latitude<input name="latitude" type="number" step="any" min="-90" max="90" required defaultValue={filters.latitude} /></label><label className="field">Center longitude<input name="longitude" type="number" step="any" min="-180" max="180" required defaultValue={filters.longitude} /></label><label className="field">Radius in meters<input name="radius_m" type="number" min="1" max="100000" required defaultValue={filters.radius_m || '1000'} /></label><button className="button">Apply distance</button><button type="button" className="secondary" onClick={() => setFilters({ ...filters, radius_m: '' })}>Clear distance</button></form>}
      </section>
      <div className="sr-workspace"><section className="panel sr-map-panel"><div className="sr-section-head sr-map-head"><div><h2>Service area</h2><p className="muted">Select a marker to inspect a request</p></div><span className="badge">{issues.length} mapped</span></div><GeoMap features={features} selectedId={selectedId} onSelect={select} center={[-96.995, 33.045]} zoom={14} /><div className="sr-legend">{Object.keys(STATUS).map(s => <span key={s}><i style={{ background: COLORS[s] }} />{STATUS[s]}</span>)}</div></section><RequestDetail key={selected?.id ?? 'empty'} issue={selected} staff={staff} isStaff={isStaff} onSaved={save} /></div>
      <div className="sr-bottom"><section className="panel"><div className="sr-section-head"><h2>Request register</h2><span className="muted">{data.total_count > 500 ? `Showing latest 500 of ${data.total_count}` : `${data.total_count} requests`}</span></div><div className="table-wrap"><table><thead><tr><th>Request</th><th>Category</th><th>Status</th><th>Assigned to</th><th>Updated</th></tr></thead><tbody>{issues.map(issue => <tr key={issue.id} className={String(selectedId) === String(issue.id) ? 'sr-selected' : ''}><td><button className="sr-title-button" onClick={() => setSelectedId(issue.id)}><small>#{String(issue.id).padStart(4, '0')}</small>{issue.title}</button></td><td className="sr-capital">{issue.category}</td><td><Status value={issue.status} /></td><td>{issue.assigned_to?.name || 'Unassigned'}</td><td>{date(issue.updated_at)}</td></tr>)}</tbody></table></div>{issues.length === 0 && <div className="empty">{loading ? 'Loading service requests…' : 'No requests match these filters.'}</div>}</section><section className="panel sr-chart"><span className="sr-eyebrow">WORKLOAD SNAPSHOT</span><h2>Requests by status</h2><BarChart items={Object.entries(STATUS).map(([key, label]) => ({ label, value: data.counts[key] || 0 }))} color="#16786f" /><p className="muted">Counts reflect your current search, status, category, and distance filters.</p></section></div>
    </>}
    {showCreate && <CreateRequest onClose={() => setShowCreate(false)} onCreated={issue => { setShowCreate(false); setFilters(EMPTY_FILTER); setSearch(''); setSelectedId(issue.id); refresh(); }} />}
  </AppShell>;
}

export default function App() {
  const { user, loading, login, logout, error } = useSession();
  if (loading) return <main className="empty">Loading Civic Works…</main>;
  if (!user) return <Login title="Civic Works" onLogin={login} error={error} />;
  return <Workspace key={user.id} user={user} logout={logout} />;
}
