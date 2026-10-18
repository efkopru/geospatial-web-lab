import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../05-infrastructure-inspections/frontend/src/App.jsx';

const shared = vi.hoisted(() => ({ api: vi.fn(), live: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => ({ user: { id: 1, name: 'Supervisor', role: 'staff' }, loading: false }),
  useLive: (_channel, callback) => { shared.live = callback; },
  usePolling: () => {},
  AppShell: ({ children }) => <main>{children}</main>,
  Stat: () => null,
  Login: () => null
}));
vi.mock('../05-infrastructure-inspections/frontend/src/CorridorViewer.jsx', () => ({ default: () => null }));

const run = (id) => ({ id, status: 'completed', created_at: '2026-10-16T12:00:00Z', summary: { min_ground_m: 10, max_ground_m: 20, max_top_m: 30, sample_count: 2, length_m: 100 } });
const newestTen = (newest) => Array.from({ length: 10 }, (_, index) => run(newest - index));
beforeEach(() => { shared.api.mockReset(); shared.live = null; });
afterEach(cleanup);

it('switches to the newest run, and loads it, when the selected run leaves the newest-ten list', async () => {
  let runs = newestTen(10);
  shared.api.mockImplementation(async (path) => {
    if (path === '/api/assets') return { assets: [] };
    if (path === '/api/profile_runs') return { profile_runs: structuredClone(runs) };
    const id = Number(path.split('/').at(-1));
    return { profile_run: run(id), samples: [{ distance_m: 0, elevation_m: 10 }, { distance_m: 100, elevation_m: 20 }], assets: [] };
  });
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Profile run'), { target: { value: '1' } });
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/1/download'));

  runs = newestTen(11);
  await act(async () => { await shared.live(); });
  await waitFor(() => expect(screen.getByLabelText('Profile run')).toHaveValue('11'));
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/11/download'));
  expect(shared.api).toHaveBeenCalledWith('/api/profile_runs/11');
  expect(screen.getByText('2 samples ready')).toBeInTheDocument();
});

it('keeps a selected run that is still in the list across a refresh', async () => {
  let runs = newestTen(10);
  shared.api.mockImplementation(async (path) => {
    if (path === '/api/assets') return { assets: [] };
    if (path === '/api/profile_runs') return { profile_runs: structuredClone(runs) };
    const id = Number(path.split('/').at(-1));
    return { profile_run: run(id), samples: [{ distance_m: 0, elevation_m: 10 }, { distance_m: 100, elevation_m: 20 }], assets: [] };
  });
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Profile run'), { target: { value: '5' } });
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/5/download'));
  runs = newestTen(11);
  await act(async () => { await shared.live(); });
  expect(screen.getByLabelText('Profile run')).toHaveValue('5');
  expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/5/download');
});
