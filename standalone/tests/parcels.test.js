import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, handle, calculateScenario, rectangleAreaM2, MAX_SCENARIOS_PER_USER } from '../04-parcel-scenarios/src/local-api.js';

const users = [{ id: 1, name: 'Alex Morgan', role: 'staff' }, { id: 2, name: 'Jordan Lee', role: 'reporter' }];
function context(state = seed(), user = users[0]) {
  const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
  return { state, user, users, now: () => '2026-09-30T12:00:00.000Z', fail, requireStaff: () => { if (user.role !== 'staff') fail('Staff role required', 403); } };
}
const request = (ctx, path, method = 'GET', body = {}) => handle({ path, method, body, query: new URLSearchParams() }, ctx);
const design = { name: 'Test courtyard', floors: 4, coverage: 0.4, unit_area: 900, parcel_ids: [1, 2] };

test('rectangle area follows spherical latitude-band area and rejects invalid bounds', () => {
  const expected = 6371008.8 ** 2 * Math.PI / 180 * Math.sin(Math.PI / 180);
  assert.ok(Math.abs(rectangleAreaM2(0, 0, 1, 1) - expected) < 0.001);
  assert.ok(rectangleAreaM2(0, 60, 1, 61) < rectangleAreaM2(0, 0, 1, 1) * 0.51);
  assert.throws(() => rectangleAreaM2(1, 0, 0, 1), /Invalid/);
});

test('scenario formula preserves floor rounding, efficiency, warnings and geometry snapshot', () => {
  const parcels = [{ id: 1, name: 'Tiny parcel', area_m2: 1000, height_limit: 3, boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }];
  const result = calculateScenario({ ...design, parcel_ids: [1] }, parcels);
  assert.equal(result.gross_floor_area_sqft, Math.round(1000 * 10.76391041671 * 0.4 * 4));
  assert.equal(result.units, Math.floor(1000 * 10.76391041671 * 0.4 * 4 * 0.8 / 900));
  assert.equal(result.floor_area_ratio, 1.6);
  assert.equal(result.warnings.length, 1);
  assert.match(result.area_method, /does not use PostGIS/);
  parcels[0].boundary.coordinates[0][0][0] = 99;
  assert.equal(result.parcel_snapshot[0].boundary.coordinates[0][0][0], 0);
});

test('demo users cannot read, export, recalculate or delete another user scenario', () => {
  const state = seed(), reporter = context(state, users[1]);
  assert.deepEqual(request(reporter, '/api/scenarios'), []);
  for (const [path, method] of [['/api/scenarios/1', 'GET'], ['/api/scenarios/1/export', 'GET'], ['/api/scenarios/1/recalculate', 'POST'], ['/api/scenarios/1', 'DELETE']]) {
    assert.throws(() => request(reporter, path, method), (error) => error.status === 404);
  }
  const own = request(reporter, '/api/scenarios', 'POST', { scenario: { ...design, user_id: 1 } });
  assert.equal(own.user_id, 2);
  assert.equal(request(reporter, '/api/scenarios').length, 1);
  assert.equal(request(context(state), '/api/scenarios').length, 2);
});

test('local save, recalculation, export and delete form a complete workflow', () => {
  const ctx = context();
  const saved = request(ctx, '/api/scenarios', 'POST', { scenario: design });
  const firstResults = structuredClone(saved.results);
  assert.equal(saved.status, 'complete');
  assert.equal(request(ctx, `/api/scenarios/${saved.id}/recalculate`, 'POST').revision, 2);
  assert.deepEqual(saved.results, firstResults);
  const exported = JSON.parse(request(ctx, `/api/scenarios/${saved.id}/export`).download.content);
  assert.equal(exported.user_id, undefined);
  assert.equal(exported.results.parcel_snapshot.length, 2);
  assert.match(exported.source, /browser-only/);
  request(ctx, `/api/scenarios/${saved.id}`, 'DELETE');
  assert.throws(() => request(ctx, `/api/scenarios/${saved.id}`), (error) => error.status === 404);
});

test('invalid or duplicate selections and invalid assumptions cannot mutate local records', () => {
  for (const changes of [{ parcel_ids: [] }, { parcel_ids: [1, 1] }, { parcel_ids: [999] }, { floors: 1.5 }, { coverage: Infinity }, { coverage: 0.99 }, { unit_area: 50 }, { name: ' ' }]) {
    const ctx = context(), before = JSON.stringify(ctx.state);
    assert.throws(() => request(ctx, '/api/scenarios', 'POST', { scenario: { ...design, ...changes } }));
    assert.equal(JSON.stringify(ctx.state), before);
  }
});

test('read routes are side-effect free and spatial/district filters work', () => {
  const ctx = context(), before = JSON.stringify(ctx.state);
  assert.equal(handle({ path: '/api/parcels', query: new URLSearchParams('district=North+quarter') }, ctx).features.length, 12);
  assert.equal(handle({ path: '/api/parcels', query: new URLSearchParams('bbox=-96.8171,32.7739,-96.8149,32.7756') }, ctx).features.length, 1);
  request(ctx, '/api/scenarios'); request(ctx, '/api/scenarios/1/export');
  assert.equal(JSON.stringify(ctx.state), before);
});

test('saved scenarios are capped per demo user, and only that user\'s deletions free their space', () => {
  const ctx = context();
  const own = () => ctx.state.scenarios.filter(scenario => scenario.user_id === users[0].id).length;
  while (own() < MAX_SCENARIOS_PER_USER) request(ctx, '/api/scenarios', 'POST', { scenario: { ...design, name: `Saved ${own()}` } });
  assert.throws(() => request(ctx, '/api/scenarios', 'POST', { scenario: design }), /You have 200 saved scenarios/);
  // Another demo user is unaffected by the first user's scenarios.
  const reporter = context(ctx.state, users[1]);
  assert.equal(request(reporter, '/api/scenarios', 'POST', { scenario: design }).user_id, users[1].id);
  request(ctx, `/api/scenarios/${ctx.state.scenarios[0].id}`, 'DELETE');
  assert.equal(request(ctx, '/api/scenarios', 'POST', { scenario: design }).name, 'Test courtyard');
  assert.equal(own(), MAX_SCENARIOS_PER_USER);
});
