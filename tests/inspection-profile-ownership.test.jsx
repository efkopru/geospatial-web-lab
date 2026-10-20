import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import App from '../05-infrastructure-inspections/frontend/src/App.jsx';

const shared = vi.hoisted(() => ({ api: vi.fn(), user: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api, useSession: () => ({ user: shared.user, loading: false }),
  useLive: () => {}, usePolling: () => {}, AppShell: ({ children }) => <main>{children}</main>,
  Stat: () => null, Login: () => <p>Sign in</p>
}));
vi.mock('../05-infrastructure-inspections/frontend/src/CorridorViewer.jsx', () => ({ default: () => null }));
afterEach(cleanup);

const run = (id) => ({ id, status: 'completed', created_at: '2026-10-20T12:00:00Z', summary: { sample_count: 2, length_m: 100, min_ground_m: 10, max_ground_m: 20, max_top_m: 30 } });
const detail = (id) => ({ profile_run: run(id), samples: [{ distance_m: 0, elevation_m: 10 }, { distance_m: 100, elevation_m: 20 }] });

it.each(['account switch', 'logout and login'])('clears private profiles and ignores an old detail response after %s', async (transition) => {
  let finishOldDetail;
  const oldDetail = new Promise((resolve) => { finishOldDetail = resolve; });
  shared.user = { id: 1, role: 'staff' };
  shared.api.mockReset().mockImplementation(async (path) => {
    if (path === '/api/assets') return { assets: [] };
    if (path === '/api/profile_runs') return { profile_runs: [run(shared.user.id * 100)] };
    if (path === '/api/profile_runs/100') return oldDetail;
    if (path === '/api/profile_runs/200') return detail(200);
    throw new Error(`Unexpected request: ${path}`);
  });
  const view = render(<App />);
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/profile_runs/100'));
  if (transition === 'logout and login') {
    shared.user = null;
    view.rerender(<App />);
    expect(screen.getByText('Sign in')).toBeVisible();
    expect(screen.queryByLabelText('Profile run')).not.toBeInTheDocument();
  }
  shared.user = { id: 2, role: 'staff' };
  view.rerender(<App />);
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/200/download'));
  await act(async () => { finishOldDetail(detail(100)); await oldDetail; });
  expect(screen.getByLabelText('Profile run')).toHaveValue('200');
  expect(screen.queryByRole('option', { name: /Run #100/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download profile GeoJSON' })).toHaveAttribute('href', '/api/profile_runs/200/download');
});
