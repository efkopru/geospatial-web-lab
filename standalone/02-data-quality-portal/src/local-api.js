import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import { cleanSample, errorSample, cleanDigest } from './sample-data.js';

const SUPPORTED = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
const MAX_BYTES = 5 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));

// Preserve JSON keys such as __proto__ as data while producing a stable byte order.
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export async function sha256(text) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 requires HTTPS or a localhost browser origin.');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

function isBlank(value) {
  return value == null || typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length || object(value) && !Object.keys(value).length;
}

/** Structural checks followed by JSTS planar OGC validity; no automatic repair. */
export function validateFeature(feature, requiredAttributes = []) {
  if (!object(feature) || feature.type !== 'Feature') return ['Record must be a GeoJSON Feature object'];
  const errors = [];
  if (!object(feature.properties)) errors.push('Properties must be an object');
  else for (const key of requiredAttributes) {
    if (!Object.hasOwn(feature.properties, key) || isBlank(feature.properties[key])) errors.push(`Required attribute '${key}' is missing or blank`);
  }
  const geometry = feature.geometry;
  if (!object(geometry)) return [...errors, 'Geometry must be an object'];
  if (!SUPPORTED.includes(geometry.type)) return [...errors, `Unsupported geometry: use ${SUPPORTED.join(', ')}`];
  let positions = 0;
  function position(value) {
    positions += 1;
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) { errors.push('Positions must contain exactly two finite numbers: longitude, latitude'); return; }
    if (value[0] < -180 || value[0] > 180) errors.push('Longitude must be between -180 and 180');
    if (value[1] < -90 || value[1] > 90) errors.push('Latitude must be between -90 and 90');
  }
  function collection(value, minimum, label, check) {
    if (!Array.isArray(value) || value.length < minimum) { errors.push(`${label} requires at least ${minimum} ${minimum === 1 ? 'member' : 'members'}`); return; }
    value.forEach(check);
  }
  const line = value => collection(value, 2, 'LineString', position);
  function polygon(value) {
    collection(value, 1, 'Polygon', ring => {
      collection(ring, 4, 'Polygon ring', position);
      if (Array.isArray(ring) && JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) errors.push('Polygon rings must be closed: first and last position must match');
    });
  }
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case 'Point': position(coordinates); break;
    case 'MultiPoint': collection(coordinates, 1, 'MultiPoint', position); break;
    case 'LineString': line(coordinates); break;
    case 'MultiLineString': collection(coordinates, 1, 'MultiLineString', line); break;
    case 'Polygon': polygon(coordinates); break;
    case 'MultiPolygon': collection(coordinates, 1, 'MultiPolygon', polygon); break;
  }
  // Bound single-operation work in the browser; rejection is explicit and visible.
  if (positions > 10000) errors.push('Browser validation supports at most 10,000 positions per feature');
  if (errors.length === 0) {
    try {
      const validity = new IsValidOp(new GeoJSONReader().read(geometry));
      if (!validity.isValid()) errors.push(`Invalid geometry: ${validity.getValidationError().getMessage()}`);
    } catch { errors.push('Geometry could not be validated by the browser topology engine'); }
  }
  return [...new Set(errors)];
}

function record(feature, ordinal, datasetId, attributes) {
  const validation_errors = validateFeature(feature, attributes);
  return { id: datasetId * 10000 + ordinal + 1, ordinal, feature: feature ?? {}, accepted: validation_errors.length === 0, validation_errors };
}

function dataset({ id, name, source, userId, attributes, time }) {
  const records = source.features.map((feature, ordinal) => record(feature, ordinal, id, attributes));
  const valid_count = records.filter(item => item.accepted).length;
  return { id, name, user_id: userId, source, source_fingerprint: JSON.stringify(canonical([source, attributes])), required_attributes: attributes,
    status: 'ready', total_count: records.length, processed_count: records.length, valid_count, invalid_count: records.length - valid_count,
    failure_message: null, records, version: null, created_at: time, updated_at: time };
}

export function seed() {
  const time = '2026-09-29T12:00:00.000Z';
  const clean = dataset({ id: 1, name: 'Parks Clean', source: clone(cleanSample), userId: 2, attributes: ['asset_id'], time });
  const content = canonical({ type: 'FeatureCollection', features: clean.records.map(item => item.feature) });
  clean.status = 'approved';
  clean.version = { id: 1, digest: cleanDigest, feature_count: clean.records.length, created_at: time, approved_by: 1, export_json: JSON.stringify(content) };
  const errors = dataset({ id: 2, name: 'Parks With Errors', source: clone(errorSample), userId: 2, attributes: ['asset_id'], time });
  return { nextId: 3, datasets: [clean, errors] };
}

function summary(item, users) {
  const { id, name, status, total_count, processed_count, valid_count, invalid_count, required_attributes, failure_message, created_at, updated_at } = item;
  const version = item.version ? { id: item.version.id, digest: item.version.digest, feature_count: item.version.feature_count, created_at: item.version.created_at } : null;
  return { id, name, status, total_count, processed_count, valid_count, invalid_count, required_attributes, failure_message, created_at, updated_at,
    owner: users.find(user => user.id === item.user_id)?.name || 'Local demo user', version };
}

export async function handle({ path, method, body = {} }, { state, user, users, now, fail, requireStaff }) {
  if (!user) fail('Choose a demo role to open the workspace', 401);
  const visible = item => user.role === 'staff' || item.user_id === user.id;
  if (path === '/api/datasets' && method === 'GET') {
    return { datasets: [...state.datasets].filter(visible).sort((a, b) => b.id - a.id).map(item => summary(item, users)) };
  }
  if (path === '/api/datasets' && method === 'POST') {
    if (typeof body.source !== 'string') fail('GeoJSON must be supplied as text');
    if (new TextEncoder().encode(body.source).length > MAX_BYTES) fail('File exceeds the 5 MB limit');
    let source;
    try { source = JSON.parse(body.source); } catch { fail('File is not valid JSON'); }
    if (!object(source) || source.type !== 'FeatureCollection' || !Array.isArray(source.features)) fail('Expected a GeoJSON FeatureCollection with a features array');
    if (source.features.length < 1 || source.features.length > 2000) fail('Upload must contain 1 to 2,000 features');
    const requested = body.required_attributes ?? ['asset_id'];
    if (!Array.isArray(requested) || !requested.every(value => typeof value === 'string')) fail('Required attributes must be an array of attribute names');
    const attributes = [...new Set(requested.map(value => value.trim()).filter(Boolean))].sort();
    if (attributes.length > 10 || attributes.some(value => !/^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/.test(value))) fail('Specify at most 10 attribute names using letters, digits, and underscores');
    const fingerprint = JSON.stringify(canonical([source, attributes]));
    const existing = state.datasets.find(item => item.user_id === user.id && item.source_fingerprint === fingerprint);
    if (existing) return { dataset: summary(existing, users), duplicate: true };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) fail('Dataset name must contain 1 to 120 characters');
    // Yield before bounded local processing so the busy state can paint.
    await new Promise(resolve => setTimeout(resolve, 0));
    const item = dataset({ id: state.nextId, name: body.name.trim(), source, userId: user.id, attributes, time: now() });
    state.nextId += 1;
    state.datasets.push(item);
    return { dataset: summary(item, users), duplicate: false };
  }
  const match = path.match(/^\/api\/datasets\/(\d+)(?:\/(approve|export|retry))?$/);
  if (!match) fail('Unknown data-quality route', 404);
  const item = state.datasets.find(value => value.id === Number(match[1]) && visible(value));
  if (!item) fail('Dataset not found for this demo role', 404);
  const action = match[2];
  if (!action && method === 'GET') return { ...summary(item, users), records: item.records,
    preview: { type: 'FeatureCollection', features: item.records.filter(value => value.accepted).map(value => ({ ...value.feature, id: value.id })) } };
  if (action === 'approve' && method === 'POST') {
    requireStaff();
    if (item.status === 'approved') return { dataset: summary(item, users) };
    if (item.status !== 'ready') fail('Validation must finish before approval');
    if (item.valid_count === 0) fail('At least one valid feature is required');
    if (item.invalid_count > 0 && body.acknowledge_rejected !== true) fail('Acknowledge excluded rejected features before approval');
    const accepted = item.records.filter(value => value.accepted).map(value => value.feature);
    const export_json = JSON.stringify(canonical({ type: 'FeatureCollection', features: accepted }));
    const digest = await sha256(export_json);
    item.version = { id: item.id, digest, feature_count: accepted.length, approved_by: user.id, created_at: now(), export_json };
    item.status = 'approved'; item.updated_at = now();
    return { dataset: summary(item, users) };
  }
  if (action === 'export' && method === 'GET') {
    if (!item.version) fail('Approve the dataset before exporting');
    return { download: { filename: `dataset-${item.id}-v1.geojson`, mime: 'application/geo+json', content: item.version.export_json } };
  }
  if (action === 'retry' && method === 'POST') {
    if (item.status !== 'failed') fail('Only failed datasets can be retried');
    const replacement = dataset({ id: item.id, name: item.name, source: item.source, userId: item.user_id, attributes: item.required_attributes, time: item.created_at });
    Object.assign(item, replacement, { updated_at: now() });
    return { dataset: summary(item, users) };
  }
  fail('Unsupported data-quality operation', 405);
}
