import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PortalApp from '../02-data-quality-portal/frontend/src/App';
import FleetApp from '../03-fleet-monitor/frontend/src/App';
import ParcelApp from '../04-parcel-scenarios/frontend/src/App';

const shared = vi.hoisted(() => ({ api: vi.fn(), session: null, live: null, maps: [] }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => shared.session,
  useLive: (_channel, callback) => { shared.live = callback; return true; },
  usePolling: () => {},
  AppShell: ({ children, actions }) => <main>{actions}{children}</main>,
  Login: () => <div>Login</div>,
  Loading: () => <div>Loading</div>,
  Notice: ({ children }) => children ? <div>{children}</div> : null,
  Stat: () => null,
  BarChart: () => null,
  GeoMap: ({ features }) => { shared.maps.push(features); return <div>Map</div>; }
}));

const summary = { id: 4, name: 'Parks', status: 'ready', total_count: 2, processed_count: 2, valid_count: 1, invalid_count: 1, required_attributes: ['asset_id'], failure_message: null, updated_at: '2026-10-04T10:00:00Z', owner: 'Staff', version: null };
const records = [
  { id: 41, ordinal: 0, accepted: true, validation_errors: [], feature: { type: 'Feature', properties: { asset_id: 'A-1' }, geometry: { type: 'Point', coordinates: [-97, 33] } } },
  { id: 42, ordinal: 1, accepted: false, validation_errors: ['Required attribute missing'], feature: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-97.1, 33.1] } } }
];

beforeEach(() => {
  shared.session = { user: { id: 1, name: 'Staff', role: 'staff' }, loading: false, logout: vi.fn() };
  shared.maps = [];
  shared.api.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const detailCalls = () => shared.api.mock.calls.filter(([path]) => path === '/datasets/4').length;

it('fetches dataset records again only when the dataset summary changes', async () => {
  let list = [summary];
  shared.api.mockImplementation(async path => path === '/datasets' ? { datasets: list } : { ...list[0], records });
  render(<PortalApp />);
  await screen.findByRole('heading', { name: 'Parks' });
  expect(detailCalls()).toBe(1);
  await act(async () => { await shared.live(); await shared.live(); });
  expect(detailCalls()).toBe(1);
  list = [{ ...summary, status: 'approved', updated_at: '2026-10-04T10:01:00Z', version: { id: 9, digest: 'abc', feature_count: 1 } }];
  await act(async () => { await shared.live(); });
  expect(detailCalls()).toBe(2);
  expect(await screen.findByRole('link', { name: 'Download approved GeoJSON' })).toBeInTheDocument();
});

it('limits record reads while a dataset validates', async () => {
  let clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  let list = [{ ...summary, status: 'validating', processed_count: 10, total_count: 100 }];
  shared.api.mockImplementation(async path => path === '/datasets' ? { datasets: list } : { ...list[0], records });
  render(<PortalApp />);
  await screen.findByRole('heading', { name: 'Parks' });
  expect(detailCalls()).toBe(1);
  list = [{ ...list[0], processed_count: 20 }];
  clock += 1000;
  await act(async () => { await shared.live(); });
  expect(detailCalls()).toBe(1);
  clock += 5000;
  await act(async () => { await shared.live(); });
  expect(detailCalls()).toBe(2);
  list = [{ ...list[0], status: 'ready', processed_count: 100 }];
  clock += 100;
  await act(async () => { await shared.live(); });
  expect(detailCalls()).toBe(3);
});

it('builds the accepted-feature preview from records', async () => {
  shared.api.mockImplementation(async path => path === '/datasets' ? { datasets: [summary] } : { ...summary, records });
  render(<PortalApp />);
  await screen.findByText('Accepted feature preview');
  await waitFor(() => expect(shared.maps.at(-1)?.features.map(feature => feature.id)).toEqual([41]));
});

it('keeps fleet map features unchanged while a zone name is typed', async () => {
  const vehicle = { id: 1, name: 'Unit 1', registration: 'GL-1', color: '#0ea5e9', longitude: -96.8, latitude: 32.78, speed_kph: 30, last_sequence: 3, captured_at: '2026-10-04T10:00:00Z', inside_geofences: [] };
  shared.api.mockImplementation(async path => {
    if (path === '/api/fleet') return { vehicles: [vehicle], geofences: [], events: [], replay: { running: false, generation: 1, cursor: 3, sequence: 3, speed: 1 }, history_limit: 360, event_limit: 500 };
    if (path === '/api/vehicles/1/history') return { vehicle, route: [[-96.8, 32.78], [-96.81, 32.79]], points: [] };
    throw new Error(path);
  });
  render(<FleetApp />);
  await waitFor(() => expect(shared.maps.at(-1)?.features.some(feature => feature.id === 'planned-route')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
  const before = shared.maps.at(-1);
  const renders = shared.maps.length;
  fireEvent.change(screen.getByLabelText('Zone name'), { target: { value: 'Depot' } });
  expect(shared.maps.length).toBeGreaterThan(renders);
  expect(shared.maps.at(-1)).toBe(before);
});

it('loads parcels once and keeps parcel map features unchanged while a scenario is named', async () => {
  const parcel = { type: 'Feature', id: 7, geometry: { type: 'Polygon', coordinates: [[[-96.8, 32.7], [-96.79, 32.7], [-96.79, 32.71], [-96.8, 32.7]]] }, properties: { id: 7, title: 'Block A', district: 'River district', area_acres: 1.2, height_limit: 6 } };
  shared.api.mockImplementation(async path => path === '/api/parcels' ? { features: [parcel] } : []);
  render(<ParcelApp />);
  await screen.findByRole('checkbox', { name: 'Select Block A' });
  await act(async () => { await shared.live(); await shared.live(); });
  expect(shared.api.mock.calls.filter(([path]) => path === '/api/parcels')).toHaveLength(1);
  expect(shared.api.mock.calls.filter(([path]) => path === '/api/scenarios')).toHaveLength(3);
  const before = shared.maps.at(-1);
  fireEvent.change(screen.getByLabelText('Scenario name'), { target: { value: 'Courtyard B' } });
  expect(shared.maps.at(-1)).toBe(before);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Block A' }));
  expect(shared.maps.at(-1)).not.toBe(before);
  expect(shared.maps.at(-1)[0].properties.color).toBe('#cc8529');
});
