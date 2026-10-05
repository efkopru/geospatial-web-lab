import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useSession, Login, AppShell, GeoMap, Stat, BarChart, useLive, usePolling } from '@geo/shared';

const statusLabel = { queued: 'In queue', validating: 'Validating', ready: 'Ready for review', approved: 'Approved', failed: 'Processing failed' };
const displayValue = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function previewViewport(collection) {
  const positions = [];
  function visit(coordinates) {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length === 2 && coordinates.every(Number.isFinite)) positions.push(coordinates);
    else coordinates.forEach(visit);
  }
  collection?.features?.forEach(feature => visit(feature.geometry?.coordinates));
  if (!positions.length) return { center: [-97.004, 33.038], zoom: 13 };
  const bounds = positions.reduce((box, [longitude, latitude]) => [Math.min(box[0], longitude), Math.min(box[1], latitude), Math.max(box[2], longitude), Math.max(box[3], latitude)], [180, 90, -180, -90]);
  const span = Math.max(bounds[2] - bounds[0], (bounds[3] - bounds[1]) * 1.5);
  return { center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2], zoom: span ? Math.max(2, Math.min(17, Math.log2(360 / span) - 1)) : 15 };
}

// A dataset's records can run to thousands of features, so they are fetched again only when
// its summary changes. While it validates, progress changes every ten features; its records
// are then fetched at most every five seconds.
const DETAIL_INTERVAL_WHILE_VALIDATING = 5000;
const detailSignature = dataset => [dataset.status, dataset.processed_count, dataset.valid_count, dataset.invalid_count, dataset.updated_at, dataset.version?.id].join('|');
function needsDetail(loaded, summary) {
  if (loaded?.id !== summary.id) return true;
  if (loaded.signature === detailSignature(summary)) return false;
  return !['queued', 'validating'].includes(summary.status) || Date.now() - loaded.at >= DETAIL_INTERVAL_WHILE_VALIDATING;
}

function Workspace({ session }) {
  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [attributes, setAttributes] = useState('asset_id');
  const [fileName, setFileName] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [filter, setFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const detailRequest = useRef(0);
  const loadedDetail = useRef(null);
  const listRequest = useRef(0);
  const fileRequest = useRef(0);
  const mounted = useRef(false);
  const activeUser = useRef(session.user?.id);
  const activeSelection = useRef(selectedId);
  activeUser.current = session.user?.id;
  activeSelection.current = selectedId;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; detailRequest.current += 1; listRequest.current += 1; fileRequest.current += 1; };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || !session.user) return;
    const userId = session.user.id;
    const listSequence = ++listRequest.current;
    try {
      const result = await api('/datasets');
      if (activeUser.current !== userId || listSequence !== listRequest.current) return;
      setDatasets(result.datasets);
      setSelectedId(current => result.datasets.some(dataset => dataset.id === current) ? current : result.datasets[0]?.id ?? null);
      const summary = result.datasets.find(dataset => dataset.id === selectedId);
      if (selectedId && activeSelection.current === selectedId && summary && needsDetail(loadedDetail.current, summary)) {
        const request = ++detailRequest.current;
        const data = await api(`/datasets/${selectedId}`);
        if (request === detailRequest.current && activeUser.current === userId && activeSelection.current === selectedId) {
          loadedDetail.current = { id: data.id, signature: detailSignature(data), at: Date.now() };
          setDetail(data);
        }
      }
    } catch (failure) { if (activeUser.current === userId && listSequence === listRequest.current) setError(failure.message); }
  }, [session.user, selectedId]);

  useEffect(() => {
    detailRequest.current += 1;
    loadedDetail.current = null;
    setDatasets([]); setSelectedId(null); setDetail(null); setError(''); setNotice('');
  }, [session.user?.id]);
  useEffect(() => { refresh(); }, [refresh]);
  usePolling(refresh, 5000);
  useLive('DatasetChannel', refresh, { session_user_id: session.user?.id ?? null });
  useEffect(() => { setAcknowledge(false); setRecordId(null); setFilter('all'); }, [selectedId]);

  async function run(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (mounted.current) await refresh(); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function readFile(file) {
    const sequence = ++fileRequest.current;
    // A rejected replacement must not leave the previous file uploadable.
    setUploadText(''); setFileName(''); setUploadName('');
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('Choose a file smaller than 5 MB.'); return; }
    try {
      const text = await file.text();
      if (sequence !== fileRequest.current) return;
      JSON.parse(text);
      setUploadText(text); setFileName(file.name); setUploadName(file.name.replace(/\.(geo)?json$/i, '').replace(/[-_]/g, ' '));
    } catch { if (sequence === fileRequest.current) setError('The selected file is not valid JSON.'); }
  }

  function selectDataset(id) {
    detailRequest.current += 1;
    loadedDetail.current = null;
    activeSelection.current = id;
    setDetail(null); setSelectedId(id); setError(''); setNotice('');
  }

  async function upload(event) {
    event.preventDefault();
    await run(async () => {
      const result = await api('/datasets', { method: 'POST', body: { name: uploadName, source: uploadText, required_attributes: attributes.split(',').map(value => value.trim()).filter(Boolean) } });
      if (!mounted.current) return;
      selectDataset(result.dataset.id); setUploadOpen(false); setUploadText(''); setFileName('');
      setNotice(result.duplicate ? 'This upload already exists. Opened the existing dataset; no duplicate records were created.' : '');
    });
  }

  async function approve() {
    await run(async () => {
      await api(`/datasets/${selectedId}/approve`, { method: 'POST', body: { acknowledge_rejected: acknowledge } });
      setNotice('Approved version created. The exported feature collection is immutable.');
    });
  }

  const active = detail?.id === selectedId ? detail : null;
  // The map shows accepted records; deriving them here keeps the API from sending each twice.
  const preview = useMemo(() => ({ type: 'FeatureCollection', features: (active?.records || []).filter(record => record.accepted).map(record => ({ ...record.feature, id: record.id })) }), [active]);
  const selectedRecord = active?.records.find(record => record.id === recordId);
  const records = (active?.records || []).filter(record => filter === 'all' || (filter === 'valid' ? record.accepted : !record.accepted));
  const complete = active && ['ready', 'approved'].includes(active.status);
  const validPercent = active?.processed_count ? Math.round(active.valid_count / active.processed_count * 100) : 0;

  return <AppShell title="Data quality portal" subtitle="Validate, review, and publish trusted spatial datasets" accent="#0d9488" user={session.user} onLogout={session.logout}
    actions={<button className="button" onClick={() => setUploadOpen(value => !value)}>{uploadOpen ? 'Close upload' : 'Upload GeoJSON'}</button>}>
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}

    {uploadOpen && <form className="panel" onSubmit={upload}>
      <h2>New dataset</h2>
      <p>Use WGS84 longitude / latitude coordinates. Point, line, and polygon geometries are supported, including their multi variants. Maximum 2,000 features and 5 MB.</p>
      <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); readFile(event.dataTransfer.files[0]); }}
        style={{ padding: 24, border: `2px dashed ${dragging ? '#0d9488' : '#b8ccc8'}`, borderRadius: 12, background: dragging ? '#f0fdfa' : '#f8fbfa', marginBottom: 16 }}>
        <label className="field">Drop a GeoJSON file here or choose a file<input type="file" accept=".json,.geojson,application/json,application/geo+json" onChange={event => readFile(event.target.files[0])} /></label>
        {fileName && <p><strong>{fileName}</strong> ready to upload</p>}
      </div>
      <div className="grid-two">
        <label className="field">Dataset name<input required maxLength={120} value={uploadName} onChange={event => setUploadName(event.target.value)} placeholder="Neighborhood park inventory" /></label>
        <label className="field">Required attributes, comma separated<input value={attributes} onChange={event => setAttributes(event.target.value)} placeholder="asset_id, name" /><small>Each feature must contain nonblank values for these keys.</small></label>
      </div>
      <button className="button" disabled={busy || !uploadText}>{busy ? 'Uploading...' : 'Upload and validate'}</button>
      <p><small>Sample files are in this project's samples folder. Validation never repairs geometry automatically.</small></p>
    </form>}

    <div className="stat-grid">
      <Stat label="Datasets" value={datasets.length} hint="Your accessible uploads" />
      <Stat label="Awaiting review" value={datasets.filter(dataset => dataset.status === 'ready').length} hint="Validation completed" />
      <Stat label="Approved" value={datasets.filter(dataset => dataset.status === 'approved').length} hint="Immutable export versions" />
      <Stat label="Rejected features" value={datasets.reduce((sum, dataset) => sum + dataset.invalid_count, 0)} hint="Visible in record review" />
    </div>

    <div className="sidebar-layout">
      <aside className="panel">
        <h2>Dataset library</h2>
        {datasets.length === 0 && <p className="empty">Upload a GeoJSON file to begin.</p>}
        {datasets.map(dataset => <button key={dataset.id} className="secondary" aria-pressed={selectedId === dataset.id} onClick={() => selectDataset(dataset.id)}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: 14, marginBottom: 10, borderColor: selectedId === dataset.id ? '#0d9488' : undefined, background: selectedId === dataset.id ? '#f0fdfa' : undefined }}>
          <strong>{dataset.name}</strong><br /><span className="badge">{statusLabel[dataset.status]}</span><br />
          <small>{dataset.total_count} features · {dataset.owner}</small>
        </button>)}
      </aside>

      <section style={{ minWidth: 0 }}>
        {!active && <div className="panel empty">{selectedId ? 'Loading dataset...' : 'Choose or upload a dataset to review.'}</div>}
        {active && <>
          <div className="panel">
            <div className="toolbar"><div><h2>{active.name}</h2><span className="badge">{statusLabel[active.status]}</span></div>
              {active.status === 'approved' && <a className="button" style={{ display: 'inline-flex', alignItems: 'center', padding: '11px 16px', borderRadius: 6, background: '#0d9488', color: '#fff', textDecoration: 'none', fontWeight: 600 }} href={`/api/datasets/${active.id}/export`} download>Download approved GeoJSON</a>}
              {active.status === 'failed' && <button className="button" disabled={busy} onClick={() => run(() => api(`/datasets/${active.id}/retry`, { method: 'POST' }))}>Retry validation</button>}
            </div>
            <p>Required attributes: <strong>{active.required_attributes.length ? active.required_attributes.join(', ') : 'none'}</strong></p>
            {['queued', 'validating'].includes(active.status) && <div role="status"><p>{active.processed_count} of {active.total_count} features processed. Updates arrive automatically.</p><progress style={{ width: '100%' }} value={active.processed_count} max={active.total_count} /></div>}
            {active.failure_message && <div className="notice">{active.failure_message}</div>}
            <div className="grid-two">
              <BarChart items={[{ label: 'Accepted', value: active.valid_count }, { label: 'Rejected', value: active.invalid_count }]} color="#0d9488" />
              <div><strong style={{ fontSize: 38, color: '#0f766e' }}>{validPercent}%</strong><p>of processed features passed both attribute and geometry checks.</p><small>{active.processed_count} / {active.total_count} reviewed</small></div>
            </div>
            {complete && active.status !== 'approved' && <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 16, paddingTop: 16 }}>
              {session.user.role === 'staff' ? <>
                <p>Approval creates an immutable version containing <strong>{active.valid_count} valid features</strong>. Rejected features remain visible in this review.</p>
                {active.invalid_count > 0 && <label style={{ display: 'block', marginBottom: 14 }}><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} /> I acknowledge that {active.invalid_count} rejected features will be excluded from the approved export.</label>}
                <button className="button" disabled={busy || active.valid_count === 0 || (active.invalid_count > 0 && !acknowledge)} onClick={approve}>Approve valid features</button>
              </> : <p className="notice">A staff user can approve the validated features. You can inspect errors and upload a corrected dataset.</p>}
            </div>}
            {active.version && <p><small>Version 1 · {active.version.feature_count} features · SHA-256 <code style={{ overflowWrap: 'anywhere' }}>{active.version.digest}</code></small></p>}
          </div>

          <div className="panel"><h2>Accepted feature preview</h2><p>Only features that pass every validation check appear on the map.</p>
            {active.valid_count > 0 ? <GeoMap key={`${active.id}-${complete ? 'complete' : 'processing'}`} features={preview} selectedId={recordId} onSelect={feature => setRecordId(typeof feature === 'object' ? feature.id : feature)} {...previewViewport(preview)} /> : <div className="empty">No accepted geometry to preview yet.</div>}
          </div>

          <div className="panel">
            <div className="toolbar"><h2>Record review</h2><label className="field">Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All records</option><option value="invalid">Rejected records</option><option value="valid">Accepted records</option></select></label></div>
            <div className="table-wrap" style={{ maxHeight: 390, overflow: 'auto' }}><table><thead><tr><th>Row</th><th>Asset</th><th>Geometry</th><th>Result</th><th>Validation findings</th></tr></thead><tbody>
              {records.map(record => <tr key={record.id} style={{ background: recordId === record.id ? '#f0fdfa' : undefined }}><td><button className="secondary" onClick={() => setRecordId(record.id)} aria-label={`Inspect record ${record.ordinal + 1}`}>{record.ordinal + 1}</button></td>
                <td>{displayValue(record.feature?.properties?.asset_id) || '(missing)'}<br /><small>{displayValue(record.feature?.properties?.name)}</small></td><td>{displayValue(record.feature?.geometry?.type) || 'Missing'}</td><td><span className="badge">{record.accepted ? 'Accepted' : 'Rejected'}</span></td>
                <td>{record.validation_errors.length ? record.validation_errors.join('; ') : 'All checks passed'}</td></tr>)}
            </tbody></table></div>
            {!records.length && <p className="empty">No records match this filter.</p>}
            {selectedRecord && <details open><summary>Source GeoJSON, record {selectedRecord.ordinal + 1}</summary><pre style={{ maxHeight: 280, overflow: 'auto', padding: 16, background: '#f5f8fa', borderRadius: 8 }}>{JSON.stringify(selectedRecord.feature, null, 2)}</pre></details>}
          </div>
        </>}
      </section>
    </div>
  </AppShell>;
}

export default function App() {
  const session = useSession();
  if (session.loading) return <div className="empty">Loading data-quality workspace...</div>;
  if (!session.user) return <Login title="Data quality portal" onLogin={session.login} error={session.error} />;
  // Account changes discard upload contents and in-flight UI state together.
  return <Workspace key={session.user.id} session={session} />;
}
