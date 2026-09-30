import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, handle, advance, recordTelemetry, controlReplay, coversPoint, validRing, distanceMeters, start, HISTORY_LIMIT, EVENT_LIMIT } from '../03-fleet-monitor/src/local-api.js';

const now = () => '2026-09-29T18:00:00.000Z';
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const context = (state, role = 'staff') => ({ state, now, fail(message, status = 422) { throw Object.assign(new Error(message), { status }); }, requireStaff() { if (role !== 'staff') throw Object.assign(new Error('Staff role required'), { status: 403 }); } });
const request = (state, path, method = 'GET', body = {}, role = 'staff') => handle({ path, method, body }, context(state, role));

test('fleet seeds ten independent routes, remains paused, and GETs do not mutate state', () => {
  const state = seed(), before = JSON.stringify(state);
  assert.equal(state.vehicles.length, 10);
  assert.equal(state.replay.running, false);
  assert.equal(state.vehicles[0].route.length, 80);
  assert.notDeepEqual(state.vehicles[0].route, state.vehicles[1].route);
  const result = request(state, '/api/fleet');
  assert.equal(result.vehicles[0].route, undefined);
  assert.equal(result.history_limit, 360);
  assert.equal(request(state, '/api/vehicles/1/history').points.length, 0);
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => request(state, '/api/missing'), /Unknown/);
  assert.throws(() => request(state, '/api/vehicles/99/history'), /not found/);
});

test('polygon checks include edges and vertices, reject intersections and degeneracies', () => {
  assert.equal(validRing(square), true);
  assert.equal(coversPoint(square, [0.5, 0.5]), true);
  assert.equal(coversPoint(square, [0, 0.5]), true);
  assert.equal(coversPoint(square, [1, 1]), true);
  assert.equal(coversPoint(square, [1.01, 1]), false);
  const concave = [[0, 0], [2, 0], [2, 2], [1, 1], [0, 2], [0, 0]];
  assert.equal(validRing(concave), true);
  assert.equal(coversPoint(concave, [1, 1.5]), false);
  for (const ring of [
    [[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]],
    [[0, 0], [1, 0], [2, 0], [0, 0]],
    [[0, 0], [1, 0], [1, 0], [0, 1], [0, 0]],
    [[0, 0], [1, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]],
    [[0, 0], [200, 0], [1, 1], [0, 0]],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
  ]) assert.equal(validRing(ring), false, JSON.stringify(ring));
});

test('replay speed advances frames, derives speed from geometry, and resets without deleting zones', () => {
  const state = seed();
  assert.equal(advance(state, now), false);
  controlReplay(state, 'speed', 4);
  controlReplay(state, 'start');
  advance(state, now);
  assert.equal(state.replay.cursor, 4);
  assert.equal(state.replay.sequence, 4);
  assert.equal(state.points[1].length, 4);
  assert.equal(state.vehicles[0].captured_at, now());
  assert.ok(state.vehicles[0].speed_kph > 0 && state.vehicles[0].speed_kph < 250);
  assert.ok(Math.abs(distanceMeters([0, 0], [0, 1]) - 111195.08) < 0.1);
  controlReplay(state, 'pause');
  assert.equal(advance(state, now), false);
  assert.equal(state.replay.cursor, 4);
  controlReplay(state, 'reset');
  assert.equal(state.replay.running, false);
  assert.equal(state.replay.cursor, 0);
  assert.equal(state.replay.speed, 4);
  assert.equal(state.vehicles[0].longitude, null);
  assert.equal(state.vehicles[0].last_sequence, -1);
  assert.equal(state.geofences.length, 2);
  assert.deepEqual(state.points, {});
  assert.deepEqual(state.events, []);
  assert.throws(() => controlReplay(state, 'speed', 3), /speed/);
  assert.throws(() => controlReplay(state, 'speed', '4'), /speed/);
});

test('telemetry is monotonic, boundary-inclusive and emits only membership transitions', () => {
  const state = seed(), vehicle = state.vehicles[0];
  state.geofences = [{ id: 1, name: 'Test zone', color: '#000000', coordinates: square }];
  const send = (sequence, longitude, latitude) => recordTelemetry(state, vehicle, { sequence, longitude, latitude, speed_kph: 12 }, now);
  assert.equal(send(1, -1, 0.5), true);
  assert.equal(state.events.length, 0);
  assert.equal(send(2, 0, 0.5), true);
  assert.equal(state.events[0].transition, 'entered');
  assert.equal(send(2, 2, 0.5), false);
  assert.equal(send(1, 2, 0.5), false);
  assert.equal(send(3, 0.5, 0.5), true);
  assert.equal(state.events.length, 1);
  assert.equal(send(4, 2, 0.5), true);
  assert.equal(state.events[1].transition, 'exited');
  assert.deepEqual(vehicle.inside_geofences, []);
  assert.throws(() => send(5, NaN, 0), /Invalid/);
  assert.throws(() => send(5, 0, 91), /Invalid/);
});

test('telemetry histories and event chronology stay bounded after long playback', () => {
  const state = seed(), vehicle = state.vehicles[0];
  state.geofences = [{ id: 1, name: 'Test zone', color: '#000000', coordinates: square }];
  for (let sequence = 1; sequence <= 700; sequence++) recordTelemetry(state, vehicle, { sequence, longitude: sequence % 2 ? 0.5 : 2, latitude: 0.5, speed_kph: 0 }, now);
  assert.equal(state.points[1].length, HISTORY_LIMIT);
  assert.equal(state.points[1][0].sequence, 341);
  assert.equal(state.events.length, EVENT_LIMIT);
  const view = request(state, '/api/fleet');
  assert.equal(view.events.length, 100);
  assert.equal(view.events[0].sequence, 700);
  assert.equal(view.events[99].sequence, 601);
});

test('geofence creation validates inputs; deletion removes memberships and events', () => {
  const state = seed();
  const geofence = request(state, '/api/geofences', 'POST', { geofence: { name: '  Local zone  ', color: '#123abc', coordinates: square } }).geofence;
  assert.equal(geofence.name, 'Local zone');
  assert.equal(geofence.id, 3);
  request(state, '/api/vehicles/1/telemetry', 'POST', { sequence: 1, longitude: 0.5, latitude: 0.5 });
  assert.ok(state.vehicles[0].inside_geofences.includes(3));
  assert.ok(state.events.some((event) => event.geofence_id === 3));
  request(state, '/api/geofences/3', 'DELETE');
  assert.ok(!state.vehicles[0].inside_geofences.includes(3));
  assert.ok(!state.events.some((event) => event.geofence_id === 3));
  assert.throws(() => request(state, '/api/geofences/3', 'DELETE'), /not found/);
  assert.throws(() => request(state, '/api/geofences', 'POST', { geofence: { name: '', color: '#123abc', coordinates: square } }), /name/);
  assert.throws(() => request(state, '/api/geofences', 'POST', { geofence: { name: 'Test', color: 'red', coordinates: square } }), /Color/);
  assert.throws(() => request(state, '/api/geofences', 'POST', { geofence: { name: 'Test', color: '#123abc', coordinates: [] } }), /Coordinates/);
});

test('simulated observer cannot mutate and manual telemetry conflicts with running replay', () => {
  const state = seed();
  for (const [path, method, body] of [['/api/fleet/control', 'POST', { action_name: 'reset' }], ['/api/geofences', 'POST', {}], ['/api/geofences/1', 'DELETE', {}], ['/api/vehicles/1/telemetry', 'POST', {}]]) assert.throws(() => request(state, path, method, body, 'reporter'), /Staff/);
  request(state, '/api/vehicles/1/telemetry', 'POST', { sequence: 100, longitude: 0, latitude: 0 });
  assert.equal(state.replay.sequence, 100);
  assert.equal(request(state, '/api/vehicles/1/telemetry', 'POST', { sequence: 99, longitude: 0, latitude: 0 }).accepted, false);
  controlReplay(state, 'start');
  assert.throws(() => request(state, '/api/vehicles/1/telemetry', 'POST', { sequence: 101, longitude: 0, latitude: 0 }), /Pause/);
  advance(state, now);
  assert.equal(state.replay.sequence, 101);
  assert.equal(state.vehicles[0].last_sequence, 101);
});

class ExclusiveLocks {
  active = null;
  queue = [];
  request(name, options, callback) {
    return new Promise((resolve, reject) => {
      const job = { name, callback, resolve, reject, options };
      job.abort = () => {
        if (this.active === job) return;
        this.queue = this.queue.filter((entry) => entry !== job);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      };
      options.signal.addEventListener('abort', job.abort);
      this.queue.push(job); this.drain();
    });
  }
  drain() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift(); this.active = job;
    Promise.resolve().then(() => job.callback({ name: job.name })).then(job.resolve, job.reject).finally(() => {
      job.options.signal.removeEventListener('abort', job.abort);
      this.active = null; this.drain();
    });
  }
}
function schedulerEnvironment(locks) {
  const timers = new Map(), listeners = new Map();
  let sequence = 0;
  return { navigator: { locks }, timers, listeners,
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    fireTimer() { const [id, callback] = timers.entries().next().value || []; if (callback) { timers.delete(id); callback(); } },
  };
}
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

test('two browser tabs elect one scheduler; handover and reopened playback pause; cleanup cancels timers', async () => {
  const state = seed(), locks = new ExclusiveLocks(), first = schedulerEnvironment(locks), second = schedulerEnvironment(locks);
  const runtime = { ready: Promise.resolve(), read: () => structuredClone(state), mutate: async (fn) => fn(state, context(state)) };
  controlReplay(state, 'start');
  const stopFirst = start(runtime, first), stopSecond = start(runtime, second);
  await flush();
  assert.equal(state.replay.running, false, 'opening persisted playback pauses it');
  assert.equal(first.timers.size, 1);
  assert.equal(second.timers.size, 0);
  controlReplay(state, 'start');
  first.fireTimer(); second.fireTimer(); await flush();
  assert.equal(state.replay.cursor, 1, 'only one frame per timer tick across both tabs');
  stopFirst(); await flush();
  assert.equal(first.timers.size, 0);
  assert.equal(second.timers.size, 1);
  assert.equal(state.replay.running, false, 'new processing tab pauses replay');
  controlReplay(state, 'start'); second.fireTimer(); await flush();
  assert.equal(state.replay.cursor, 2);
  stopSecond(); await flush();
  assert.equal(second.timers.size, 0);
  assert.equal(locks.active, null);
});

test('unsupported coordination disables playback explicitly instead of permitting duplicate timers', async () => {
  const state = seed(), environment = schedulerEnvironment(undefined);
  controlReplay(state, 'start');
  const stop = start({ ready: Promise.resolve(), read: () => structuredClone(state), mutate: async (fn) => fn(state, context(state)) }, environment);
  await flush();
  assert.equal(state.replay.running, false);
  assert.equal(environment.timers.size, 0);
  assert.equal(request(state, '/api/fleet').replay.available, false);
  assert.throws(() => request(state, '/api/fleet/control', 'POST', { action_name: 'start' }), /Web Locks/);
  stop();
});
