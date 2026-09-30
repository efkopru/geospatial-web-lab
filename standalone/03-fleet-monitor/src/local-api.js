// Synthetic fleet domain. No Rails, database server, or WebSocket is required.
export const HISTORY_LIMIT = 360;
export const EVENT_LIMIT = 500;
export const FRAME_SECONDS = 10;
const LOCK_NAME = 'geospatial-standalone-fleet-replay-v1';
let playbackAvailable = typeof navigator !== 'undefined' && Boolean(navigator.locks?.request);
let playbackReason = playbackAvailable ? '' : 'Replay requires Web Locks in a supported browser on localhost or HTTPS. This prevents duplicate playback across tabs.';

export function seed() {
  const corners = [[-96.818, 32.765], [-96.784, 32.765], [-96.784, 32.792], [-96.818, 32.792], [-96.818, 32.765]];
  const route = corners.slice(0, -1).flatMap((point, edge) => Array.from({ length: 20 }, (_, index) => point.map((value, axis) => value + (corners[edge + 1][axis] - value) * index / 20)));
  const colors = ['#06b6d4', '#f97316', '#8b5cf6', '#22c55e', '#eab308', '#ec4899', '#3b82f6', '#14b8a6', '#ef4444', '#a855f7'];
  return {
    replay: { running: false, cursor: 0, sequence: 0, generation: 0, speed: 1, simulation: true },
    vehicles: colors.map((color, index) => ({
      id: index + 1, name: `Unit ${String(index + 1).padStart(2, '0')}`, registration: `SIM-${String(index + 1).padStart(3, '0')}`, color,
      longitude: null, latitude: null, speed_kph: 0, captured_at: null, last_sequence: -1, inside_geofences: [],
      route: route.map(([longitude, latitude]) => [longitude + (index % 3 - 1) * 0.001, latitude + (index % 2) * 0.001]), route_offset: index * 8,
    })),
    geofences: [
      { id: 1, name: 'North depot', color: '#8b5cf6', coordinates: [[-96.808, 32.788], [-96.779, 32.788], [-96.779, 32.798], [-96.808, 32.798], [-96.808, 32.788]] },
      { id: 2, name: 'South service area', color: '#f59e0b', coordinates: [[-96.824, 32.758], [-96.801, 32.758], [-96.801, 32.770], [-96.824, 32.770], [-96.824, 32.758]] },
    ],
    points: {}, events: [], nextFenceId: 3, nextEventId: 1, nextPointId: 1,
  };
}

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const EPSILON = 1e-12;
function onSegment(point, a, b) {
  return Math.abs(cross(a, b, point)) <= EPSILON && point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON && point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}
function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON) && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON)) || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

// Planar longitude/latitude membership, with ring boundaries counted as inside.
// Matches the local seed use of ST_Covers on EPSG:4326 geometry, not geography.
export function coversPoint(ring, point) {
  let inside = false;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = ring[index], b = ring[index + 1];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function validRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 200 || !ring.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90) || !samePoint(ring[0], ring.at(-1))) return false;
  // Translate before summing to avoid cancellation for small rings far from 0,0.
  const origin = ring[0];
  let twiceArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    if (samePoint(ring[i], ring[i + 1])) return false;
    twiceArea += cross(origin, ring[i], ring[i + 1]);
    for (let j = i + 1; j < ring.length - 1; j++) {
      if (j === i + 1 || i === 0 && j === ring.length - 2) continue;
      if (intersects(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
    // Adjacent edges may meet once but must not backtrack over one another.
    const previous = ring[(i + ring.length - 2) % (ring.length - 1)];
    if (onSegment(ring[i + 1], previous, ring[i]) || onSegment(previous, ring[i], ring[i + 1])) return false;
  }
  return Math.abs(twiceArea) > EPSILON;
}

export function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const latitudeDelta = (b[1] - a[1]) * radians, longitudeDelta = (b[0] - a[0]) * radians;
  const h = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}

function vehiclePayload(vehicle) {
  const { route, route_offset, ...payload } = vehicle;
  return payload;
}

export function recordTelemetry(state, vehicle, telemetry, now) {
  const { sequence, longitude, latitude, speed_kph = 0 } = telemetry;
  if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(speed_kph) || speed_kph < 0 || speed_kph > 250) throw new Error('Invalid telemetry coordinates, sequence, or speed');
  if (sequence <= vehicle.last_sequence) return false;
  const captured_at = now();
  const previousMembership = new Set(vehicle.inside_geofences);
  Object.assign(vehicle, { longitude, latitude, speed_kph, captured_at, last_sequence: sequence });
  vehicle.inside_geofences = [];
  for (const fence of state.geofences) {
    const inside = coversPoint(fence.coordinates, [longitude, latitude]);
    if (inside) vehicle.inside_geofences.push(fence.id);
    if (inside !== previousMembership.has(fence.id)) state.events.push({ id: state.nextEventId++, vehicle_id: vehicle.id, vehicle_name: vehicle.name, geofence_id: fence.id, geofence_name: fence.name, transition: inside ? 'entered' : 'exited', sequence, captured_at });
  }
  const points = state.points[vehicle.id] ||= [];
  points.push({ id: state.nextPointId++, sequence, longitude, latitude, speed_kph, captured_at });
  state.points[vehicle.id] = points.slice(-HISTORY_LIMIT);
  state.events = state.events.slice(-EVENT_LIMIT);
  return true;
}

export function advance(state, now = () => new Date().toISOString()) {
  if (!state.replay.running) return false;
  for (let frame = 0; frame < state.replay.speed; frame++) {
    const sequence = state.replay.sequence + 1;
    for (const vehicle of state.vehicles) {
      const index = (state.replay.cursor + vehicle.route_offset) % vehicle.route.length;
      const point = vehicle.route[index], previous = vehicle.route[(index - 1 + vehicle.route.length) % vehicle.route.length];
      recordTelemetry(state, vehicle, { sequence, longitude: point[0], latitude: point[1], speed_kph: Math.min(250, distanceMeters(previous, point) / FRAME_SECONDS * 3.6) }, now);
    }
    state.replay.cursor++;
    state.replay.sequence = sequence;
  }
  return true;
}

export function controlReplay(state, action, speed) {
  const replay = state.replay;
  if (action === 'start') {
    if (!replay.running) { replay.running = true; replay.generation++; }
  } else if (action === 'pause') {
    if (replay.running) { replay.running = false; replay.generation++; }
  } else if (action === 'speed') {
    if (![1, 2, 4].includes(speed)) throw new Error('Replay speed must be 1, 2, or 4');
    replay.speed = speed;
  } else if (action === 'reset') {
    Object.assign(replay, { running: false, cursor: 0, sequence: 0, generation: replay.generation + 1 });
    state.events = []; state.points = {};
    for (const vehicle of state.vehicles) Object.assign(vehicle, { longitude: null, latitude: null, speed_kph: 0, captured_at: null, last_sequence: -1, inside_geofences: [] });
  } else throw new Error('Unknown replay action');
  return replay;
}

export function handle({ path, method = 'GET', body = {} }, { state, now, fail, requireStaff }) {
  if (path === '/api/fleet' && method === 'GET') return { replay: { ...state.replay, available: playbackAvailable, reason: playbackReason }, vehicles: state.vehicles.map(vehiclePayload), geofences: state.geofences, events: state.events.slice(-100).reverse(), history_limit: HISTORY_LIMIT, event_limit: EVENT_LIMIT };
  if (path === '/api/fleet/control' && method === 'POST') {
    requireStaff();
    if (body.action_name === 'start' && !playbackAvailable) fail(playbackReason);
    return { replay: controlReplay(state, body.action_name, body.speed) };
  }
  let match = path.match(/^\/api\/vehicles\/(\d+)\/(history|telemetry)$/);
  if (match) {
    const vehicle = state.vehicles.find((entry) => entry.id === Number(match[1]));
    if (!vehicle) fail('Vehicle not found', 404);
    if (match[2] === 'history' && method === 'GET') return { vehicle: vehiclePayload(vehicle), route: vehicle.route, points: state.points[vehicle.id] || [] };
    if (match[2] === 'telemetry' && method === 'POST') {
      requireStaff();
      if (state.replay.running) fail('Pause the simulation before submitting manual telemetry', 409);
      const accepted = recordTelemetry(state, vehicle, body, now);
      if (accepted) state.replay.sequence = Math.max(state.replay.sequence, vehicle.last_sequence);
      return { accepted, reason: accepted ? 'recorded' : 'duplicate_or_out_of_order' };
    }
  }
  if (path === '/api/geofences' && method === 'POST') {
    requireStaff();
    const input = body.geofence || {}, name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 80) fail('Zone name must contain 1 to 80 characters');
    if (!/^#[0-9a-fA-F]{6}$/.test(input.color || '')) fail('Color must be a six-digit hexadecimal value');
    if (!validRing(input.coordinates)) fail('Coordinates must form a closed, non-intersecting polygon with positive area and 4 to 200 valid coordinate pairs');
    const geofence = { id: state.nextFenceId++, name, color: input.color, coordinates: input.coordinates };
    state.geofences.push(geofence);
    return { geofence };
  }
  match = path.match(/^\/api\/geofences\/(\d+)$/);
  if (match && method === 'DELETE') {
    requireStaff();
    const id = Number(match[1]);
    if (!state.geofences.some((fence) => fence.id === id)) fail('Geofence not found', 404);
    state.geofences = state.geofences.filter((fence) => fence.id !== id);
    state.events = state.events.filter((event) => event.geofence_id !== id);
    for (const vehicle of state.vehicles) vehicle.inside_geofences = vehicle.inside_geofences.filter((fenceId) => fenceId !== id);
    return { deleted: true };
  }
  fail('Unknown fleet operation', 404);
}

// One tab holds the replay lock. All tabs may control the shared local state.
// A new lock owner pauses persisted playback, so closing/reopening never silently
// resumes a simulation. Timers advance frames, never elapsed real-world time.
export function start(runtime, environment = globalThis) {
  const locks = environment.navigator?.locks;
  playbackAvailable = Boolean(locks?.request);
  playbackReason = playbackAvailable ? '' : 'Replay requires Web Locks in a supported browser on localhost or HTTPS. This prevents duplicate playback across tabs.';
  let stopped = false, timer = null, releaseLock;
  const abort = new AbortController();
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (playbackAvailable) {
      playbackAvailable = false;
      playbackReason = 'Replay stopped when this page was left. Reload this page to enable playback.';
    }
    if (timer != null) environment.clearTimeout(timer);
    abort.abort();
    releaseLock?.();
    environment.removeEventListener?.('pagehide', onPageHide);
  };
  const onPageHide = () => {
    playbackAvailable = false;
    playbackReason = 'Replay stopped when this page was left. Reload this page to enable playback.';
    cleanup();
  };
  environment.addEventListener?.('pagehide', onPageHide);
  const pausePersisted = async () => {
    await runtime.mutate((state) => { if (state.replay.running) controlReplay(state, 'pause'); });
  };
  const loop = async () => {
    if (stopped) return;
    if (runtime.read().replay.running) await runtime.mutate((state, context) => { if (!stopped) advance(state, context.now); });
    if (!stopped) timer = environment.setTimeout(() => { loop().catch(failure); }, 1000);
  };
  const failure = (error) => {
    if (stopped || error?.name === 'AbortError') return;
    playbackAvailable = false;
    playbackReason = `Replay stopped: ${error?.message || 'local storage or browser coordination failed'}. Reload after resolving the problem.`;
    runtime.reportError?.(error);
    cleanup();
    pausePersisted().catch(() => {});
  };
  Promise.resolve(runtime.ready).then(async () => {
    if (stopped) return;
    if (!playbackAvailable) { await pausePersisted(); return; }
    await locks.request(LOCK_NAME, { mode: 'exclusive', signal: abort.signal }, async () => {
      if (stopped) return;
      await pausePersisted();
      if (stopped) return;
      const held = new Promise((resolve) => { releaseLock = resolve; });
      await loop();
      await held;
    });
  }).catch(failure);
  return cleanup;
}
