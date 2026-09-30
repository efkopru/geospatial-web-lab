import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, handle, buildProfile, greatCircleDistance, interpolateGreatCircle } from '../05-infrastructure-inspections/src/local-api.js';

const users = [{ id: 1, name: 'Alex Morgan', role: 'staff' }, { id: 2, name: 'Jordan Lee', role: 'reporter' }, { id: 3, name: 'Casey Rivera', role: 'staff' }];
function context(state = seed(), user = users[0]) {
  const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
  return { state, user, users, now: () => '2026-09-30T12:00:00.000Z', fail, requireStaff: () => { if (user.role !== 'staff') fail('Staff role required', 403); } };
}
const request = (ctx, path, method = 'GET', inspection) => handle({ path, method, body: inspection ? { inspection } : {} }, ctx);

test('great-circle interpolation takes the short route across the antimeridian', () => {
  const a = { longitude: 179, latitude: 0 }, b = { longitude: -179, latitude: 0 };
  assert.ok(Math.abs(greatCircleDistance(a, b) - 222390.160467) < 0.01);
  const middle = interpolateGreatCircle(a, b, 0.5);
  assert.ok(Math.abs(Math.abs(middle.longitude) - 180) < 1e-9);
  assert.ok(Math.abs(middle.latitude) < 1e-9);
  assert.deepEqual(interpolateGreatCircle(a, a, 0.5), a);
  assert.throws(() => interpolateGreatCircle({ longitude: 0, latitude: 0 }, { longitude: 180, latitude: 0 }, 0.5), /Antipodal/);
});

test('corridor profile preserves 71 samples, heights and endpoint measurements', () => {
  const { assets } = seed(), profile = buildProfile(assets);
  assert.equal(profile.samples.length, 71);
  assert.equal(profile.summary.min_ground_m, 1658);
  assert.equal(profile.summary.max_ground_m, 1702);
  assert.equal(profile.summary.max_top_m, 1750);
  assert.equal(profile.samples[0].elevation_m, 1665);
  assert.equal(profile.samples.at(-1).elevation_m, 1690);
  assert.ok(profile.summary.length_m > 1735 && profile.summary.length_m < 1750);
  assert.ok(profile.samples.every((sample, index, list) => !index || sample.distance_m >= list[index - 1].distance_m));
  assert.throws(() => buildProfile([assets[0]]), /At least two/);
});

test('reporter observations retain authorship and cannot resolve through the adapter', () => {
  const state = seed(), ctx = context(state, users[1]);
  const result = request(ctx, '/api/assets/1/inspections', 'POST', { severity: 'critical', notes: 'Synthetic damage needs immediate review.', observed_at: '2026-09-30T11:00:00Z', author_id: 1, status: 'resolved' });
  assert.equal(result.inspection.author_name, 'Jordan Lee');
  assert.equal(result.inspection.status, 'open');
  assert.equal(result.inspection.events[0].action, 'reported');
  assert.equal(request(ctx, '/api/assets/1').asset.critical_inspections, 1);
  assert.throws(() => request(ctx, `/api/inspections/${result.inspection.id}`, 'PATCH', { status: 'resolved', resolution_notes: 'Completed required repairs.', lock_version: 0 }), (error) => error.status === 403);
});

test('staff resolution/reopening records history and rejects stale writes without mutation', () => {
  const ctx = context();
  const resolved = request(ctx, '/api/inspections/1', 'PATCH', { status: 'resolved', resolution_notes: 'Replaced the synthetic damaged brace.', lock_version: 0 }).inspection;
  assert.equal(resolved.lock_version, 1);
  assert.equal(resolved.events.at(-1).actor_name, 'Alex Morgan');
  assert.equal(request(ctx, '/api/assets/3').asset.open_inspections, 0);
  const staleState = JSON.stringify(ctx.state);
  assert.throws(() => request(context(ctx.state, users[2]), '/api/inspections/1', 'PATCH', { status: 'open', resolution_notes: 'Follow-up requires another inspection.', lock_version: 0 }), (error) => error.status === 409);
  assert.equal(JSON.stringify(ctx.state), staleState);
  const reopened = request(context(ctx.state, users[2]), '/api/inspections/1', 'PATCH', { status: 'open', resolution_notes: 'Follow-up requires another inspection.', lock_version: 1 }).inspection;
  assert.equal(reopened.lock_version, 2);
  assert.equal(reopened.resolved_at, null);
  assert.equal(reopened.events.at(-1).action, 'reopened');
  assert.equal(reopened.events.at(-1).actor_name, 'Casey Rivera');
});

test('invalid observation dates and notes leave state untouched', () => {
  for (const attributes of [{ severity: 'invalid' }, { notes: 'short' }, { observed_at: 'not-a-date' }, { observed_at: '2027-01-01T00:00:00Z' }]) {
    const ctx = context(), before = JSON.stringify(ctx.state);
    assert.throws(() => request(ctx, '/api/assets/1/inspections', 'POST', { severity: 'low', notes: 'A valid synthetic observation.', observed_at: '2026-09-30T11:00:00Z', ...attributes }));
    assert.equal(JSON.stringify(ctx.state), before);
  }
});

test('profiles preserve a source snapshot and export actual calculated GeoJSON', () => {
  const ctx = context();
  const created = request(ctx, '/api/profile_runs', 'POST').profile_run;
  assert.equal(created.status, 'completed');
  ctx.state.assets[0].ground_elevation_m = 2500;
  const detail = request(ctx, `/api/profile_runs/${created.id}`);
  assert.equal(detail.assets[0].ground_elevation_m, 1665);
  const output = request(ctx, `/api/profile_runs/${created.id}/download`).download;
  const document = JSON.parse(output.content);
  assert.equal(document.features.length, 71);
  assert.equal(document.features[0].geometry.coordinates[2], 1665);
  assert.match(document.metadata.source, /spherical/);
  assert.equal(document.metadata.summary.max_top_m, 1750);
  assert.throws(() => request(ctx, `/api/profile_runs/${created.id}/retry`, 'POST'), (error) => error.status === 409);
});

test('GET routes never mutate persisted state', () => {
  const ctx = context();
  request(ctx, '/api/profile_runs', 'POST');
  const before = JSON.stringify(ctx.state);
  for (const path of ['/api/assets', '/api/assets/3', '/api/profile_runs', '/api/profile_runs/1', '/api/profile_runs/1/download']) request(ctx, path);
  assert.equal(JSON.stringify(ctx.state), before);
});
