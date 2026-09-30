import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, handle, canonical, validateFeature } from '../02-data-quality-portal/src/local-api.js';

const users = [{ id: 1, role: 'staff', name: 'Alex Morgan' }, { id: 2, role: 'reporter', name: 'Jordan Lee' }, { id: 3, role: 'staff', name: 'Casey Rivera' }];
function context(state, userId = 1) {
  const user = users.find(value => value.id === userId);
  const fail = (message, status = 422) => { const error = new Error(message); error.status = status; throw error; };
  return { state, users, user, now: () => '2026-09-30T00:00:00.000Z', fail, requireStaff: () => { if (user.role !== 'staff') fail('Staff demo role required', 403); } };
}
const point = (properties = { asset_id: 'A' }, coordinates = [-97, 33]) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
const polygon = rings => ({ type: 'Feature', properties: { asset_id: 'P' }, geometry: { type: 'Polygon', coordinates: rings } });
const source = features => JSON.stringify({ type: 'FeatureCollection', features });
const upload = (state, features, fields = {}, userId = 1) => handle({ path: '/api/datasets', method: 'POST', body: { name: 'Test dataset', source: source(features), required_attributes: ['asset_id'], ...fields } }, context(state, userId));

test('seed fixtures validate to the same accepted/rejected counts as the full-stack sample', () => {
  const state = seed();
  assert.equal(state.datasets[0].valid_count, 4);
  assert.equal(state.datasets[0].invalid_count, 0);
  assert.equal(state.datasets[1].valid_count, 2);
  assert.equal(state.datasets[1].invalid_count, 4);
  assert.match(state.datasets[1].records[3].validation_errors.join(), /Self-intersection/);
  const approved = state.datasets[0].version;
  assert.equal(createHash('sha256').update(approved.export_json).digest('hex'), approved.digest);
});

test('coordinate and GeoJSON structure validation rejects unsupported, malformed, empty, or non-finite input', () => {
  assert.deepEqual(validateFeature(point({ asset_id: false })), []);
  assert.match(validateFeature(point({}, [181, 91]), ['asset_id']).join(), /missing or blank.*Longitude.*Latitude/);
  assert.match(validateFeature(point(undefined, [-97, 33, 1])).join(), /exactly two finite/);
  assert.match(validateFeature(point(undefined, [NaN, 33])).join(), /exactly two finite/);
  assert.match(validateFeature({ type: 'Feature', properties: [], geometry: null }).join(), /Properties.*Geometry/);
  assert.match(validateFeature({ type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [] } }).join(), /Unsupported geometry/);
  assert.match(validateFeature({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [] } }).join(), /at least 1/);
  assert.match(validateFeature(polygon([[[0, 0], [2, 0], [2, 2], [0, 2]]])).join(), /rings must be closed/);
  assert.match(validateFeature(null).join(), /Feature object/);
  assert.match(validateFeature(point({ asset_id: {} }), ['asset_id']).join(), /missing or blank/);
});

test('JSTS detects polygon self-crossing, holes outside shells, degenerate lines, and overlapping multipolygons', () => {
  assert.match(validateFeature(polygon([[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]])).join(), /Self-intersection/);
  const shell = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const outside = [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]];
  const inside = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
  assert.match(validateFeature(polygon([shell, outside])).join(), /Hole lies outside shell/);
  assert.deepEqual(validateFeature(polygon([shell, inside])), []);
  assert.match(validateFeature({ ...point(), geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0]] } }).join(), /Too few distinct points/);
  assert.match(validateFeature({ ...point(), geometry: { type: 'MultiPolygon', coordinates: [[shell], [[[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]]]] } }).join(), /Invalid geometry/);
});

test('approval excludes rejected records only after an explicit Boolean acknowledgment; export bytes stay fixed', async () => {
  const state = seed();
  const request = { path: '/api/datasets/2/approve', method: 'POST', body: {} };
  await assert.rejects(handle(request, context(state)), /Acknowledge/);
  await assert.rejects(handle({ ...request, body: { acknowledge_rejected: 'true' } }, context(state)), /Acknowledge/);
  await assert.rejects(handle({ ...request, body: { acknowledge_rejected: true } }, context(state, 2)), /Staff demo role/);
  assert.equal(state.datasets[1].version, null);
  const approved = await handle({ ...request, body: { acknowledge_rejected: true } }, context(state));
  const first = await handle({ path: '/api/datasets/2/export', method: 'GET' }, context(state, 2));
  assert.equal(JSON.parse(first.download.content).features.length, 2);
  assert.equal(createHash('sha256').update(first.download.content).digest('hex'), approved.dataset.version.digest);
  // An accidental later edit to source/review data must not rewrite an approved export.
  state.datasets[1].records[0].feature.properties.name = 'Changed review name';
  await handle(request, context(state));
  const again = await handle({ path: '/api/datasets/2/export', method: 'GET' }, context(state));
  assert.equal(again.download.content, first.download.content);
});

test('zero accepted records cannot be approved or exported', async () => {
  const state = seed();
  const result = await upload(state, [point({}, [0, 100])]);
  const id = result.dataset.id;
  await assert.rejects(handle({ path: `/api/datasets/${id}/approve`, method: 'POST', body: { acknowledge_rejected: true } }, context(state)), /At least one valid/);
  await assert.rejects(handle({ path: `/api/datasets/${id}/export`, method: 'GET' }, context(state)), /Approve/);
});

test('duplicate detection is canonical, scoped by demo owner, and includes the required attribute policy', async () => {
  const state = seed();
  const first = await upload(state, [point()]);
  const reordered = { geometry: { coordinates: [-97, 33], type: 'Point' }, properties: { asset_id: 'A' }, type: 'Feature' };
  const duplicate = await upload(state, [reordered], { name: 'Different name' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.dataset.id, duplicate.dataset.id);
  assert.equal((await upload(state, [point()], { required_attributes: ['name'] })).duplicate, false);
  const reporter = await upload(state, [point()], {}, 2);
  assert.equal(reporter.duplicate, false);
  const visible = await handle({ path: '/api/datasets', method: 'GET' }, context(state, 2));
  assert(!visible.datasets.some(item => item.id === first.dataset.id));
  await assert.rejects(handle({ path: `/api/datasets/${first.dataset.id}`, method: 'GET' }, context(state, 2)), error => error.status === 404);
});

test('input boundaries and methods fail explicitly without creating a dataset', async () => {
  const state = seed();
  await assert.rejects(upload(state, []), /1 to 2,000/);
  await assert.rejects(upload(state, Array(2001).fill(point())), /1 to 2,000/);
  await assert.rejects(upload(state, [point()], { name: ' ' }), /Dataset name/);
  await assert.rejects(upload(state, [point()], { required_attributes: [12] }), /array of attribute names/);
  await assert.rejects(upload(state, [point()], { required_attributes: ['a-b'] }), /letters, digits/);
  await assert.rejects(upload(state, [point()], { source: 'x'.repeat(5 * 1024 * 1024 + 1) }), /5 MB/);
  await assert.rejects(upload(state, [point()], { source: '{}' }), /FeatureCollection/);
  await assert.rejects(handle({ path: '/api/datasets/1', method: 'DELETE' }, context(state)), error => error.status === 405);
  assert.equal(state.datasets.length, 2);
  assert.equal(state.nextId, 3);
});

test('canonical serialization retains prototype-like source property names as data', () => {
  const input = JSON.parse('{"z":1,"__proto__":{"asset_id":"value"},"a":2}');
  const result = canonical(input);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(JSON.stringify(result), '{"__proto__":{"asset_id":"value"},"a":2,"z":1}');
  const inherited = Object.create({ asset_id: 'inherited' });
  assert.match(validateFeature(point(inherited), ['asset_id']).join(), /missing or blank/);
});
