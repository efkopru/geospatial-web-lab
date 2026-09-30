import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import FleetApp from '../03-fleet-monitor/frontend/src/App.jsx';
import InspectionApp from '../05-infrastructure-inspections/frontend/src/App.jsx';

const shared = vi.hoisted(() => ({ api: vi.fn(), session: null, live: {} }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => shared.session,
  useLive: (channel, callback) => { shared.live[channel] = callback; },
  usePolling: () => {},
  Login: () => <div>Sign in</div>,
  AppShell: ({ children }) => <main>{children}</main>,
  GeoMap: () => null,
  Stat: () => null,
  BarChart: () => null
}));
vi.mock('../05-infrastructure-inspections/frontend/src/CorridorViewer.jsx', () => ({ default: () => null }));

const fleet = { vehicles: [], geofences: [], events: [], replay: { running: false, cursor: 0, sequence: 0, speed: 1 } };
const asset = { id: 7, asset_code: 'TEST-A', name: 'Tower A', kind: 'tower', longitude: -105, latitude: 40, ground_elevation_m: 1600, structure_height_m: 30, top_elevation_m: 1630, open_inspections: 1 };
const inspection = { id: 9, status: 'open', severity: 'high', observed_at: '2026-09-29T12:00:00Z', notes: 'Connection needs repair.', author_name: 'Inspector', events: [], lock_version: 0 };

beforeEach(() => {
  shared.session = { user: { id: 1, name: 'First operator', role: 'staff' }, loading: false };
  shared.live = {};
  shared.api.mockReset().mockImplementation(async (path) => {
    if (path === '/api/fleet') return fleet;
    if (path === '/api/assets') return { assets: [asset] };
    if (path === '/api/assets/7') return { asset, inspections: [inspection] };
    if (path === '/api/profile_runs') return { profile_runs: [] };
    throw new Error(`Unexpected API request: ${path}`);
  });
});
afterEach(cleanup);

function changeSession(view, App, transition) {
  if (transition === 'logout and login') {
    shared.session = { ...shared.session, user: null };
    view.rerender(<App />);
    expect(screen.getByText('Sign in')).toBeVisible();
  }
  shared.session = { ...shared.session, user: { id: transition === 'account switch' ? 2 : 1, name: 'Current operator', role: 'staff' } };
  view.rerender(<App />);
}

it.each(['account switch', 'logout and login'])('clears private fleet drafts on %s', async (transition) => {
  const view = render(<FleetApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add zone' }));
  fireEvent.change(screen.getByLabelText('Zone name'), { target: { value: 'Private unsaved zone' } });
  const oldRefresh = shared.live.ReplayChannel;
  changeSession(view, FleetApp, transition);
  expect(screen.queryByDisplayValue('Private unsaved zone')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Add zone' }));
  expect(screen.getByLabelText('Zone name')).toHaveValue('');
  const calls = shared.api.mock.calls.length;
  await act(async () => { await oldRefresh(); });
  expect(shared.api.mock.calls.length).toBe(calls);
});

it.each(['account switch', 'logout and login'])('clears private inspection resolution notes on %s', async (transition) => {
  const view = render(<InspectionApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve observation' }));
  fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Private unsaved resolution notes.' } });
  const oldRefresh = shared.live.InspectionChannel;
  changeSession(view, InspectionApp, transition);
  expect(screen.queryByDisplayValue('Private unsaved resolution notes.')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve observation' }));
  expect(screen.getByLabelText('Resolution notes')).toHaveValue('');
  const calls = shared.api.mock.calls.length;
  await act(async () => { await oldRefresh(); });
  expect(shared.api.mock.calls.length).toBe(calls);
});
