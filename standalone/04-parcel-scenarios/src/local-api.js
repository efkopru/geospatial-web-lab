const EARTH_RADIUS_M = 6371008.8;
const SQFT_PER_M2 = 10.76391041671;
const AREA_METHOD = 'Spherical geographic rectangle area; mean Earth radius 6371008.8 m. This browser edition does not use PostGIS ellipsoidal area.';
const INITIAL_TIME = '2026-09-29T15:00:00.000Z';
const round = (value, places = 2) => Number(value.toFixed(places));
const radians = (degrees) => degrees * Math.PI / 180;

// The bundled parcels are rectangles bounded by meridians and parallels.
// This is deliberately not advertised as a general polygon area algorithm.
export function rectangleAreaM2(west, south, east, north) {
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) throw new Error('Invalid geographic rectangle');
  return EARTH_RADIUS_M ** 2 * radians(east - west) * (Math.sin(radians(north)) - Math.sin(radians(south)));
}

function makeParcels() {
  return Array.from({ length: 24 }, (_, index) => {
    const x = round(-96.817 + (index % 6) * 0.003, 7);
    const y = round(32.774 + Math.floor(index / 6) * 0.0025, 7);
    const east = round(x + 0.002, 7), north = round(y + 0.0015, 7);
    return { id: index + 1, name: `Parcel ${String(index + 1).padStart(3, '0')}`, district: index < 12 ? 'River district' : 'North quarter', height_limit: index % 3 === 0 ? 6 : 12,
      area_m2: rectangleAreaM2(x, y, east, north), boundary: { type: 'Polygon', coordinates: [[[x, y], [east, y], [east, north], [x, north], [x, y]]] } };
  });
}

export function calculateScenario(scenario, parcels) {
  const chosen = parcels.filter((parcel) => scenario.parcel_ids.includes(parcel.id));
  if (chosen.length !== scenario.parcel_ids.length) throw new Error('A selected parcel no longer exists');
  const siteSqft = chosen.reduce((sum, parcel) => sum + parcel.area_m2, 0) * SQFT_PER_M2;
  const gross = siteSqft * scenario.coverage * scenario.floors;
  const residential = gross * 0.8;
  return { formula_version: 1, area_method: AREA_METHOD, site_acres: round(siteSqft / 43560), gross_floor_area_sqft: Math.round(gross), residential_area_sqft: Math.round(residential),
    units: Math.floor(residential / scenario.unit_area), open_space_sqft: Math.round(siteSqft * (1 - scenario.coverage)), floor_area_ratio: round(scenario.coverage * scenario.floors),
    warnings: chosen.filter((parcel) => scenario.floors > parcel.height_limit).map((parcel) => `${parcel.name}: ${scenario.floors} floors exceeds the synthetic ${parcel.height_limit}-floor limit`),
    assumptions: { residential_efficiency: 0.8, unit_area_sqft: scenario.unit_area, floors: scenario.floors, coverage: scenario.coverage },
    parcel_snapshot: chosen.map((parcel) => ({ id: parcel.id, name: parcel.name, area_m2: round(parcel.area_m2, 3), boundary: structuredClone(parcel.boundary) })) };
}

export function seed() {
  const parcels = makeParcels();
  const scenarios = [{ name: 'Courtyard homes', floors: 3, coverage: 0.35, unit_area: 900 }, { name: 'Mixed-use blocks', floors: 7, coverage: 0.55, unit_area: 850 }].map((attributes, index) => {
    const scenario = { ...attributes, id: index + 1, user_id: 1, parcel_ids: [1, 2, 3, 4], status: 'complete', revision: 1, created_at: INITIAL_TIME, updated_at: INITIAL_TIME, error_message: null };
    return { ...scenario, results: calculateScenario(scenario, parcels) };
  });
  return { schema_version: 1, parcels, scenarios, nextScenarioId: 3 };
}

function validateScenario(input, state, fail) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('scenario must be an object', 400);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) fail('Scenario name must contain 1 to 100 characters');
  const { floors, coverage, unit_area: unitArea, parcel_ids: parcelIds } = input;
  if (!Number.isInteger(floors) || floors < 1 || floors > 30) fail('Floors must be an integer from 1 to 30');
  if (!Number.isFinite(coverage) || coverage < 0.05 || coverage > 0.8) fail('Coverage must be from 0.05 to 0.8');
  if (!Number.isInteger(unitArea) || unitArea < 400 || unitArea > 3000) fail('Unit area must be an integer from 400 to 3000 square feet');
  if (!Array.isArray(parcelIds) || !parcelIds.length || parcelIds.length > 50 || new Set(parcelIds).size !== parcelIds.length || parcelIds.some((id) => !Number.isInteger(id) || !state.parcels.some((parcel) => parcel.id === id))) fail('Select 1 to 50 distinct existing parcels');
  return { name, floors, coverage, unit_area: unitArea, parcel_ids: [...parcelIds] };
}

export function handle({ path, method = 'GET', body = {}, query = new URLSearchParams() }, context) {
  const { state, user, now, fail } = context;
  if (!user) fail('Choose a demo user first', 401);
  if (path === '/api/parcels' && method === 'GET') {
    let parcels = state.parcels;
    if (query.get('district')) parcels = parcels.filter((parcel) => parcel.district === query.get('district'));
    if (query.has('bbox')) {
      const bbox = query.get('bbox').split(',').map(Number);
      if (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) fail('bbox must be west,south,east,north within geographic bounds');
      parcels = parcels.filter((parcel) => { const ring = parcel.boundary.coordinates[0]; return ring[2][0] >= bbox[0] && ring[0][0] <= bbox[2] && ring[2][1] >= bbox[1] && ring[0][1] <= bbox[3]; });
    }
    return { type: 'FeatureCollection', features: parcels.map((parcel) => ({ type: 'Feature', id: parcel.id, geometry: parcel.boundary, properties: { id: parcel.id, title: parcel.name, district: parcel.district, area_acres: round(parcel.area_m2 / 4046.8564224), height_limit: parcel.height_limit } })), area_method: AREA_METHOD };
  }
  if (path === '/api/scenarios' && method === 'GET') return state.scenarios.filter((scenario) => scenario.user_id === user.id).sort((a, b) => b.id - a.id);
  if (path === '/api/scenarios' && method === 'POST') {
    const attributes = validateScenario(body.scenario, state, fail);
    const timestamp = now();
    const scenario = { ...attributes, id: state.nextScenarioId++, user_id: user.id, status: 'complete', revision: 1, created_at: timestamp, updated_at: timestamp, error_message: null };
    scenario.results = calculateScenario(scenario, state.parcels);
    state.scenarios.push(scenario);
    return scenario;
  }
  const match = path.match(/^\/api\/scenarios\/(\d+)(?:\/(recalculate|export))?$/);
  if (match) {
    const scenario = state.scenarios.find((entry) => entry.id === Number(match[1]) && entry.user_id === user.id);
    if (!scenario) fail('Scenario not found for this demo user', 404);
    if (!match[2] && method === 'GET') return scenario;
    if (!match[2] && method === 'DELETE') { state.scenarios = state.scenarios.filter((entry) => entry.id !== scenario.id); return null; }
    if (match[2] === 'recalculate' && method === 'POST') {
      scenario.results = calculateScenario(scenario, state.parcels);
      scenario.revision += 1; scenario.status = 'complete'; scenario.error_message = null; scenario.updated_at = now();
      return scenario;
    }
    if (match[2] === 'export' && method === 'GET') {
      if (scenario.status !== 'complete') fail('Scenario calculation must finish first', 409);
      const { user_id, ...document } = scenario;
      return { download: { filename: `scenario-${scenario.id}.json`, mime: 'application/json', content: JSON.stringify({ ...document, source: 'Synthetic browser-only planning exercise; locally stored demo data' }, null, 2) } };
    }
  }
  fail(`Unknown local route: ${method} ${path}`, 404);
}
