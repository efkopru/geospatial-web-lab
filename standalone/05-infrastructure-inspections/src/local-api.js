const RADIUS_M = 6371008.8;
const INITIAL_TIME = '2026-09-29T15:00:00.000Z';
// The workspace lists the newest 10 runs; older completed runs are pruned so each save stays small.
export const PROFILE_RUN_LIMIT = 20;
const PROFILE_SOURCE = 'Synthetic base elevations; linear elevation interpolation along spherical great-circle segments (mean radius 6371008.8 m); not a DEM or PostGIS ellipsoidal calculation';
const round = (value, places = 2) => Number(value.toFixed(places));
const rad = (value) => value * Math.PI / 180;
const deg = (value) => value * 180 / Math.PI;
const longitude = (value) => ((value + 180) % 360 + 360) % 360 - 180;

function validatePoint(point) {
  if (![point.longitude, point.latitude].every(Number.isFinite) || Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 90) throw new Error('Invalid geographic coordinates');
}

export function greatCircleDistance(first, last) {
  validatePoint(first); validatePoint(last);
  const phi1 = rad(first.latitude), phi2 = rad(last.latitude);
  const a = Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(rad(longitude(last.longitude - first.longitude)) / 2) ** 2;
  return 2 * RADIUS_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

export function interpolateGreatCircle(first, last, fraction) {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Interpolation fraction must be from zero to one');
  const distance = greatCircleDistance(first, last);
  if (fraction === 0 || distance < 1e-8) return { longitude: first.longitude, latitude: first.latitude };
  if (fraction === 1) return { longitude: last.longitude, latitude: last.latitude };
  if (Math.abs(Math.PI - distance / RADIUS_M) < 1e-8) throw new Error('Antipodal endpoints do not define a unique corridor segment');
  const phi1 = rad(first.latitude), phi2 = rad(last.latitude), lambda1 = rad(first.longitude), deltaLambda = rad(longitude(last.longitude - first.longitude));
  const bearing = Math.atan2(Math.sin(deltaLambda) * Math.cos(phi2), Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda));
  const angle = distance / RADIUS_M * fraction;
  const latitude = Math.asin(Math.max(-1, Math.min(1, Math.sin(phi1) * Math.cos(angle) + Math.cos(phi1) * Math.sin(angle) * Math.cos(bearing))));
  const resultLongitude = lambda1 + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(phi1), Math.cos(angle) - Math.sin(phi1) * Math.sin(latitude));
  return { longitude: longitude(deg(resultLongitude)), latitude: deg(latitude) };
}

export function buildProfile(assets) {
  if (!Array.isArray(assets) || assets.length < 2) throw new Error('At least two assets are required for a corridor profile');
  assets.forEach((asset) => { validatePoint(asset); if (![asset.ground_elevation_m, asset.structure_height_m].every(Number.isFinite)) throw new Error('Asset elevations and heights must be finite'); });
  let distance = 0;
  const samples = [];
  for (let index = 0; index < assets.length - 1; index++) {
    const first = assets[index], last = assets[index + 1];
    const segmentLength = greatCircleDistance(first, last);
    for (let step = 0; step < 10; step++) {
      const ratio = step / 10, point = interpolateGreatCircle(first, last, ratio);
      samples.push({ distance_m: round(distance + segmentLength * ratio), ...point, elevation_m: round(first.ground_elevation_m + (last.ground_elevation_m - first.ground_elevation_m) * ratio) });
    }
    distance += segmentLength;
  }
  const last = assets.at(-1);
  samples.push({ distance_m: round(distance), longitude: last.longitude, latitude: last.latitude, elevation_m: last.ground_elevation_m });
  return { samples, summary: { length_m: round(distance), min_ground_m: Math.min(...samples.map((sample) => sample.elevation_m)), max_ground_m: Math.max(...samples.map((sample) => sample.elevation_m)),
    max_top_m: Math.max(...assets.map((asset) => asset.ground_elevation_m + asset.structure_height_m)), asset_count: assets.length, sample_count: samples.length, distance_method: 'Mean-radius spherical great-circle, 6371008.8 m' } };
}

export function seed() {
  const rows = [
    ['P-101', 'West approach pole', 'pole', -105.2810, 39.9830, 1665, 16], ['P-102', 'Creek crossing pole', 'pole', -105.2780, 39.9841, 1658, 18],
    ['T-201', 'Ridge transmission tower', 'tower', -105.2748, 39.9850, 1678, 42], ['C-301', 'Ridge control cabinet', 'cabinet', -105.2732, 39.9854, 1681, 2.4],
    ['P-103', 'East slope pole', 'pole', -105.2711, 39.9865, 1689, 20], ['T-202', 'Summit relay tower', 'tower', -105.2681, 39.9876, 1702, 48],
    ['P-104', 'Service road pole', 'pole', -105.2650, 39.9871, 1694, 16], ['C-302', 'East control cabinet', 'cabinet', -105.2624, 39.9882, 1690, 2.2]
  ];
  const assets = rows.map(([asset_code, name, kind, longitude, latitude, ground_elevation_m, structure_height_m], index) => ({ id: index + 1, asset_code, name, kind, longitude, latitude, ground_elevation_m, structure_height_m, corridor_order: index }));
  const observations = [
    [3, 2, 'high', 'Synthetic observation: corrosion visible at the lower tower cross-brace. Schedule a close inspection.'],
    [5, 1, 'medium', 'Synthetic observation: vegetation is approaching the pole access route. Confirm clearance at the next visit.']
  ];
  const inspections = observations.map(([infrastructure_asset_id, author_id, severity, notes], index) => ({ id: index + 1, infrastructure_asset_id, author_id, severity, notes, status: 'open', lock_version: 0, observed_at: INITIAL_TIME, created_at: INITIAL_TIME, resolution_notes: null, resolved_at: null, resolved_by_id: null,
    events: [{ id: index + 1, actor_id: author_id, action: 'reported', notes, created_at: INITIAL_TIME }] }));
  return { schema_version: 1, assets, inspections, profileRuns: [], nextInspectionId: 3, nextEventId: 3, nextProfileId: 1 };
}

function assetPayload(asset, state) {
  const open = state.inspections.filter((inspection) => inspection.infrastructure_asset_id === asset.id && inspection.status === 'open');
  return { ...asset, top_elevation_m: asset.ground_elevation_m + asset.structure_height_m, open_inspections: open.length, critical_inspections: open.filter((inspection) => inspection.severity === 'critical').length };
}
function inspectionPayload(inspection, users) {
  const name = (id) => users.find((user) => user.id === id)?.name || 'Demo user';
  return { ...inspection, author_name: name(inspection.author_id), resolved_by_name: inspection.resolved_by_id ? name(inspection.resolved_by_id) : null, events: inspection.events.map((event) => ({ ...event, actor_name: name(event.actor_id) })) };
}
function profilePayload(run) {
  const { samples, asset_snapshot, user_id, ...payload } = run;
  return { ...payload, source: PROFILE_SOURCE };
}
function profileDocument(run) {
  return { type: 'FeatureCollection', name: `synthetic-corridor-profile-${run.id}`, metadata: { source: PROFILE_SOURCE, summary: run.summary, assets: run.asset_snapshot },
    features: run.samples.map((sample) => ({ type: 'Feature', properties: { distance_m: sample.distance_m, synthetic_elevation_m: sample.elevation_m }, geometry: { type: 'Point', coordinates: [sample.longitude, sample.latitude, sample.elevation_m] } })) };
}
function objectBody(body, fail) {
  if (!body.inspection || typeof body.inspection !== 'object' || Array.isArray(body.inspection)) fail('inspection must be an object', 400);
  return body.inspection;
}
function validNotes(value, fail) {
  const notes = typeof value === 'string' ? value.trim() : '';
  if (notes.length < 10 || notes.length > 2000) fail('Observation, resolution or reopening notes must contain 10 to 2000 characters');
  return notes;
}

export function handle({ path, method = 'GET', body = {} }, context) {
  const { state, user, users, now, fail, requireStaff } = context;
  if (!user) fail('Choose a demo user first', 401);
  if (path === '/api/assets' && method === 'GET') return { assets: state.assets.map((asset) => assetPayload(asset, state)), source: 'Synthetic corridor assets and elevations' };
  let match = path.match(/^\/api\/assets\/(\d+)(?:\/(inspections))?$/);
  if (match) {
    const asset = state.assets.find((entry) => entry.id === Number(match[1]));
    if (!asset) fail('Asset not found', 404);
    if (!match[2] && method === 'GET') return { asset: assetPayload(asset, state), inspections: state.inspections.filter((inspection) => inspection.infrastructure_asset_id === asset.id).sort((a, b) => b.id - a.id).map((inspection) => inspectionPayload(inspection, users)) };
    if (match[2] === 'inspections' && method === 'POST') {
      const attributes = objectBody(body, fail), notes = validNotes(attributes.notes, fail), timestamp = now();
      if (!['low', 'medium', 'high', 'critical'].includes(attributes.severity)) fail('Choose a valid observation severity');
      const observedTime = Date.parse(attributes.observed_at);
      if (!Number.isFinite(observedTime) || observedTime > Date.parse(timestamp) + 300000) fail('Observation time must be valid and cannot be more than five minutes in the future');
      const inspection = { id: state.nextInspectionId++, infrastructure_asset_id: asset.id, author_id: user.id, notes, severity: attributes.severity, status: 'open', lock_version: 0, observed_at: new Date(observedTime).toISOString(), created_at: timestamp, resolution_notes: null, resolved_at: null, resolved_by_id: null,
        events: [{ id: state.nextEventId++, actor_id: user.id, action: 'reported', notes, created_at: timestamp }] };
      state.inspections.push(inspection);
      return { inspection: inspectionPayload(inspection, users) };
    }
  }
  match = path.match(/^\/api\/inspections\/(\d+)$/);
  if (match && method === 'PATCH') {
    requireStaff();
    const inspection = state.inspections.find((entry) => entry.id === Number(match[1]));
    if (!inspection) fail('Observation not found', 404);
    const attributes = objectBody(body, fail), notes = validNotes(attributes.resolution_notes, fail);
    if (!Number.isInteger(attributes.lock_version) || attributes.lock_version < 0 || attributes.lock_version > 2147483647) fail('lock_version must be an integer from 0 to 2147483647', 400);
    if (attributes.lock_version !== inspection.lock_version) fail('This observation changed. Reload it before saving another status change.', 409);
    if (!['open', 'resolved'].includes(attributes.status) || attributes.status === inspection.status) fail('Choose a different status: open or resolved');
    const timestamp = now();
    Object.assign(inspection, { status: attributes.status, resolution_notes: notes, resolved_at: attributes.status === 'resolved' ? timestamp : null, resolved_by_id: attributes.status === 'resolved' ? user.id : null, lock_version: inspection.lock_version + 1 });
    inspection.events.push({ id: state.nextEventId++, actor_id: user.id, action: attributes.status === 'resolved' ? 'resolved' : 'reopened', notes, created_at: timestamp });
    return { inspection: inspectionPayload(inspection, users) };
  }
  if (path === '/api/profile_runs' && method === 'GET') return { profile_runs: [...state.profileRuns].sort((a, b) => b.id - a.id).slice(0, 10).map(profilePayload) };
  if (path === '/api/profile_runs' && method === 'POST') {
    const assets = structuredClone(state.assets).sort((a, b) => a.corridor_order - b.corridor_order || a.id - b.id);
    const result = buildProfile(assets), timestamp = now();
    const run = { id: state.nextProfileId++, user_id: user.id, status: 'completed', generation: 1, created_at: timestamp, completed_at: timestamp, error_message: null, asset_snapshot: assets, ...result };
    state.profileRuns.push(run);
    state.profileRuns = state.profileRuns.slice(-PROFILE_RUN_LIMIT);
    return { profile_run: profilePayload(run) };
  }
  match = path.match(/^\/api\/profile_runs\/(\d+)(?:\/(download|retry))?$/);
  if (match) {
    const run = state.profileRuns.find((entry) => entry.id === Number(match[1]));
    if (!run) fail('Profile run not found', 404);
    if (!match[2] && method === 'GET') return { profile_run: profilePayload(run), samples: run.samples, assets: run.asset_snapshot };
    if (match[2] === 'download' && method === 'GET') {
      if (run.status !== 'completed') fail('Profile is not complete', 409);
      return { download: { filename: `synthetic-corridor-profile-${run.id}.geojson`, mime: 'application/geo+json', content: JSON.stringify(profileDocument(run), null, 2) } };
    }
    if (match[2] === 'retry' && method === 'POST') {
      if (run.status !== 'failed') fail('Only failed profile runs can be retried', 409);
      Object.assign(run, buildProfile(run.asset_snapshot), { status: 'completed', generation: run.generation + 1, completed_at: now(), error_message: null });
      return { profile_run: profilePayload(run) };
    }
  }
  fail(`Unknown local route: ${method} ${path}`, 404);
}
