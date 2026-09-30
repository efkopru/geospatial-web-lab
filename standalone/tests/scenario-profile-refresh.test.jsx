import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ParcelApp from '../04-parcel-scenarios/src/App.jsx';
import InspectionApp from '../05-infrastructure-inspections/src/App.jsx';

const shared = vi.hoisted(() => ({ api: vi.fn(), live: null, session: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => shared.session,
  useLive: (_channel, callback) => { shared.live = callback; return true; },
  usePolling: () => {},
  Loading: () => <div>Loading</div>, Login: () => <div>Login</div>,
  AppShell: ({ children }) => <main>{children}</main>,
  Stat: ({ label, value }) => <div>{label}: {value}</div>,
  BarChart: () => <div>Comparison chart</div>, GeoMap: () => <div>Map</div>,
  Notice: ({ children, error }) => children ? <div role={error ? 'alert' : 'status'}>{children}</div> : null
}));
vi.mock('../05-infrastructure-inspections/src/CorridorViewer.jsx', () => ({ default: () => <div>Corridor scene</div> }));
beforeEach(() => { shared.api.mockReset(); shared.live = null; shared.session = { user: { id: 1, name: 'Alex Morgan', role: 'staff' }, loading: false, logout: vi.fn() }; });
afterEach(cleanup);

it('releases comparison slots after a compared scenario disappears in another tab', async () => {
  let scenarios = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: `Scenario ${index + 1}`, status: 'complete', floors: 4, coverage: 0.4,
    results: { units: 100, gross_floor_area_sqft: 120000, open_space_sqft: 20000, floor_area_ratio: 1.6, warnings: [] } }));
  shared.api.mockImplementation(async (path) => path === '/api/parcels' ? { features: [] } : structuredClone(scenarios));
  render(<ParcelApp />);
  await screen.findByRole('checkbox', { name: 'Compare Scenario 1' });
  for (let id = 1; id <= 4; id++) fireEvent.click(screen.getByRole('checkbox', { name: `Compare Scenario ${id}` }));
  expect(screen.getByRole('checkbox', { name: 'Compare Scenario 5' })).toBeDisabled();
  scenarios = scenarios.filter((scenario) => scenario.id !== 1);
  await act(async () => shared.live());
  expect(screen.queryByRole('checkbox', { name: 'Compare Scenario 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Compare Scenario 5' })).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Scenario 5' }));
  expect(screen.getByRole('checkbox', { name: 'Compare Scenario 5' })).toBeChecked();
});

it('switches to the newest profile when a selected older run leaves the recent list', async () => {
  const run = (id) => ({ id, status: 'completed', created_at: '2026-09-30T12:00:00Z', summary: { min_ground_m: 10, max_ground_m: 20, max_top_m: 30, sample_count: 2, length_m: 100 } });
  let runs = Array.from({ length: 10 }, (_, index) => run(10 - index));
  shared.api.mockImplementation(async (path) => {
    if (path === '/api/assets') return { assets: [] };
    if (path === '/api/profile_runs') return { profile_runs: structuredClone(runs) };
    const id = Number(path.split('/').at(-1));
    return { profile_run: run(id), samples: [{ distance_m: 0, elevation_m: 10 }, { distance_m: 100, elevation_m: 20 }], assets: [] };
  });
  render(<InspectionApp />);
  const select = await screen.findByLabelText('Profile run');
  fireEvent.change(select, { target: { value: '1' } });
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/1/download'));
  runs = Array.from({ length: 10 }, (_, index) => run(11 - index));
  await act(async () => shared.live());
  await waitFor(() => expect(screen.getByLabelText('Profile run')).toHaveValue('11'));
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/11/download'));
  expect(shared.api).toHaveBeenCalledWith('/api/profile_runs/11');
});
