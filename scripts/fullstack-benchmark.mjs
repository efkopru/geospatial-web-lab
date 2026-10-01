// Measures one running full-stack application through its nginx proxy: API latency, read
// throughput under concurrency, and how long background jobs (Sidekiq + PostGIS) take to
// finish. Run it against a seeded stack, e.g. after `scripts/container-smoke.sh <project> --keep`.
// Usage: node scripts/fullstack-benchmark.mjs <0N-project> [base-url] [--quick]
// Prints a Markdown table; with GITHUB_STEP_SUMMARY set it also appends the table there.
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const [project, baseArg] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const quick = process.argv.includes('--quick');
const number = Number(project?.match(/^0([1-5])-/)?.[1]);
if (!number) { console.error('Usage: node scripts/fullstack-benchmark.mjs <0N-project> [base-url] [--quick]'); process.exit(2); }
const base = (baseArg || `http://127.0.0.1:${5170 + number}`).replace(/\/$/, '');
const rows = [];
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A minimal cookie-and-CSRF client for the Rails session API.
let cookies = new Map(), csrf = '';
async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (data?.csrf_token) csrf = data.csrf_token;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  return data;
}
async function login(email = 'staff@example.test') {
  cookies = new Map(); csrf = '';
  await api('/api/session');
  await api('/api/session', { method: 'POST', body: { email, password: 'Learning123!' } });
}
async function timed(task) { const start = performance.now(); const value = await task(); return { ms: performance.now() - start, value }; }
async function latency(operation, size, runs, task) {
  const times = [];
  for (let run = 0; run < runs; run++) times.push((await timed(() => task(run))).ms);
  rows.push({ operation, size, result: `median ${median(times).toFixed(1)} ms, p95 ${percentile(times, 0.95).toFixed(1)} ms (${runs} requests)` });
}
async function throughput(operation, size, total, concurrency, task) {
  const times = []; let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < total) { const index = next++; times.push((await timed(() => task(index))).ms); } }));
  const seconds = (performance.now() - start) / 1000;
  rows.push({ operation, size, result: `${(total / seconds).toFixed(1)} requests/s, median ${median(times).toFixed(1)} ms, p95 ${percentile(times, 0.95).toFixed(1)} ms (${total} requests, ${concurrency} concurrent)` });
}
// Time from the request that queues a job until polling shows a final status.
async function untilDone(start, poll, done, failed, timeoutMs = 300000) {
  const begin = performance.now();
  let value = await start();
  while (!done(value)) {
    if (failed?.(value)) throw new Error(`Job failed: ${JSON.stringify(value).slice(0, 300)}`);
    if (performance.now() - begin > timeoutMs) throw new Error(`Job did not finish within ${timeoutMs / 1000}s`);
    await sleep(100);
    value = await poll(value);
  }
  return performance.now() - begin;
}
async function jobs(operation, size, runs, run) {
  const times = [];
  for (let index = 0; index < runs; index++) times.push(await run(index));
  rows.push({ operation, size, result: `median ${(median(times) / 1000).toFixed(2)} s, max ${(Math.max(...times) / 1000).toFixed(2)} s (${runs} jobs)` });
}
const pointCollection = (count, seed) => ({ type: 'FeatureCollection', features: Array.from({ length: count }, (_, index) => ({ type: 'Feature', properties: { title: `Benchmark ${seed}-${index}`, category: 'roads' }, geometry: { type: 'Point', coordinates: [-97 + (index % 50) * 0.0004, 33.02 + Math.floor(index / 50) * 0.0004 + seed * 0.00001] } })) });
const ring = (x, y, vertices) => { const points = Array.from({ length: vertices }, (_, index) => { const angle = index / vertices * 2 * Math.PI; return [x + Math.cos(angle) * 0.0005, y + Math.sin(angle) * 0.0005]; }); return [...points, points[0]]; };
const polygons = (count, vertices, seed) => JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: count }, (_, index) => ({ type: 'Feature', properties: { asset_id: `A-${seed}-${index}` }, geometry: { type: 'Polygon', coordinates: [ring(-97 + (index % 50) * 0.002, 33 + Math.floor(index / 50) * 0.002, vertices)] } })) });

const benchmarks = {
  async '01-service-requests'() {
    await latency('Create one request', 'seeded data', quick ? 10 : 50, run => api('/api/issues', { method: 'POST', body: { issue: { title: `Latency ${run}`, category: 'roads', latitude: 33.04, longitude: -96.99 } } }));
    // Imports report progress through the list endpoint, so poll it for this import's id.
    const importRun = async seed => {
      const begin = performance.now();
      const { import: created } = await api('/api/import_runs', { method: 'POST', body: { geojson: pointCollection(500, seed) } });
      let current = created;
      while (current.status !== 'completed') {
        if (current.status === 'failed') throw new Error(`Import failed: ${current.failure}`);
        if (performance.now() - begin > 300000) throw new Error('Import did not finish within 300s');
        await sleep(100);
        current = (await api('/api/import_runs')).imports.find(run => run.id === created.id);
      }
      return performance.now() - begin;
    };
    const imports = quick ? 2 : 8;
    await jobs('Import 500 point features (worker + PostGIS)', 'growing to ~4,000 requests', imports, index => importRun(index + 1));
    const total = (await api('/api/issues')).total_count;
    await latency('List with 1 km distance filter', `${total} requests`, quick ? 10 : 30, () => api('/api/issues?latitude=33.045&longitude=-96.995&radius_m=1000'));
    await throughput('Concurrent list with distance filter', `${total} requests`, quick ? 40 : 200, 10, () => api('/api/issues?latitude=33.045&longitude=-96.995&radius_m=1000'));
    await jobs('Generate CSV export (worker)', `${total} requests`, quick ? 2 : 5, async () => {
      const begin = performance.now();
      const { export: created } = await api('/api/export_runs', { method: 'POST' });
      let current = created;
      while (current.status !== 'completed') {
        if (current.status === 'failed') throw new Error(`Export failed: ${current.failure}`);
        await sleep(100);
        current = (await api('/api/export_runs')).exports.find(run => run.id === created.id);
      }
      return performance.now() - begin;
    });
  },
  async '02-data-quality-portal'() {
    const validate = (count, vertices) => async index => untilDone(
      () => api('/api/datasets', { method: 'POST', body: { name: `Benchmark ${count}x${vertices}-${index}`, source: polygons(count, vertices, `${count}-${vertices}-${index}`), required_attributes: ['asset_id'] } }),
      async value => ({ dataset: await api(`/api/datasets/${(value.dataset ?? value).id}`) }),
      value => ['ready', 'approved'].includes((value.dataset ?? value).status),
      value => (value.dataset ?? value).status === 'failed');
    for (const [count, vertices] of quick ? [[500, 16]] : [[500, 16], [2000, 16], [2000, 64]]) {
      const bytes = Buffer.byteLength(polygons(count, vertices, 'size'));
      await jobs('Upload and validate GeoJSON (worker + PostGIS)', `${count} polygons x ${vertices} vertices (${Math.round(bytes / 1024)} KB)`, quick ? 1 : 3, validate(count, vertices));
    }
    const { datasets } = await api('/api/datasets');
    await latency('Dataset list', `${datasets.length} datasets`, quick ? 10 : 30, () => api('/api/datasets'));
    const largest = datasets.toSorted((a, b) => b.total_count - a.total_count)[0];
    await latency('Dataset detail with records', `${largest.total_count} records`, quick ? 5 : 15, () => api(`/api/datasets/${largest.id}`));
    await throughput('Concurrent dataset list', `${datasets.length} datasets`, quick ? 40 : 200, 10, () => api('/api/datasets'));
  },
  async '03-fleet-monitor'() {
    const fleet = await api('/api/fleet');
    if (fleet.replay.running) await api('/api/fleet/control', { method: 'POST', body: { action_name: 'pause' } });
    let sequence = (await api('/api/fleet')).replay.sequence;
    const vehicles = fleet.vehicles.map(vehicle => vehicle.id);
    const posts = quick ? 50 : 400;
    await latency('Record manual telemetry (PostGIS geofence check)', `${vehicles.length} vehicles`, posts, run => api(`/api/vehicles/${vehicles[run % vehicles.length]}/telemetry`, { method: 'POST', body: { sequence: ++sequence, longitude: -96.8 + (run % 40) * 0.001, latitude: 32.78 + (run % 25) * 0.001, speed_kph: 40 } }));
    await latency('Fleet snapshot', 'after telemetry', quick ? 10 : 30, () => api('/api/fleet'));
    await latency('Vehicle history', `up to ${fleet.history_limit} points`, quick ? 10 : 30, run => api(`/api/vehicles/${vehicles[run % vehicles.length]}/history`));
    await throughput('Concurrent fleet snapshot', `${vehicles.length} vehicles`, quick ? 40 : 200, 10, () => api('/api/fleet'));
  },
  async '04-parcel-scenarios'() {
    const parcels = (await api('/api/parcels')).features.map(feature => feature.id ?? feature.properties?.id).slice(0, 6);
    const calculate = async index => untilDone(
      () => api('/api/scenarios', { method: 'POST', body: { scenario: { name: `Benchmark ${index}`, floors: 4 + (index % 6), coverage: 0.5, unit_area: 900, parcel_ids: parcels } } }),
      async value => api(`/api/scenarios/${value.id}`),
      value => value.status === 'complete',
      value => value.status === 'failed');
    await jobs('Save and calculate a scenario (worker + PostGIS area)', '6 parcels', quick ? 3 : 20, calculate);
    const scenarios = (await api('/api/scenarios')).length;
    await latency('Scenario list', `${scenarios} scenarios`, quick ? 10 : 30, () => api('/api/scenarios'));
    await throughput('Concurrent parcel layer', '24 parcels', quick ? 40 : 200, 10, () => api('/api/parcels'));
  },
  async '05-infrastructure-inspections'() {
    const profile = async () => untilDone(
      () => api('/api/profile_runs', { method: 'POST', body: {} }),
      async value => api(`/api/profile_runs/${(value.profile_run ?? value).id}`),
      value => (value.profile_run ?? value).status === 'completed',
      value => (value.profile_run ?? value).status === 'failed');
    await jobs('Generate corridor profile (worker + PostGIS geography)', '8 assets, 71 samples', quick ? 3 : 15, profile);
    await latency('Asset register', '8 assets', quick ? 10 : 30, () => api('/api/assets'));
    await throughput('Concurrent asset register', '8 assets', quick ? 40 : 200, 10, () => api('/api/assets'));
  }
};

await login();
await benchmarks[project]();
const table = [`### ${project}`, '', `Measured through nginx at ${base} on ${new Date().toISOString()}.`, '', '| Operation | Data size | Result |', '| --- | --- | --- |', ...rows.map(row => `| ${row.operation} | ${row.size} | ${row.result} |`), ''].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
