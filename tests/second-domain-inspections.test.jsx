import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../05-infrastructure-inspections/frontend/src/App.jsx';

const shared = vi.hoisted(() => ({ api: vi.fn(), user: { id: 1, role: 'staff' } }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => ({ user: shared.user }),
  AppShell: ({ children }) => <div>{children}</div>,
  Stat: () => null,
  useLive: () => {},
  usePolling: () => {},
  Login: () => null
}));
vi.mock('../05-infrastructure-inspections/frontend/src/CorridorViewer.jsx', () => ({ default: () => null }));

const asset = (id) => ({ id, asset_code: `TEST-${id}`, name: `Tower ${id}`, kind: 'tower', structure_height_m: 30, ground_elevation_m: 1600, top_elevation_m: 1630, open_inspections: 0 });
const assets = [asset(1), asset(2)];
beforeEach(() => { shared.api.mockReset(); });
afterEach(cleanup);

it('a delayed observation save preserves the current asset draft and detail', async () => {
  let finishSave;
  const save = new Promise((resolve) => { finishSave = resolve; });
  shared.api.mockImplementation((path, options) => {
    if (options?.method === 'POST') return save;
    if (path === '/api/assets') return Promise.resolve({ assets });
    if (path === '/api/profile_runs') return Promise.resolve({ profile_runs: [] });
    const id = Number(path.split('/').at(-1));
    return Promise.resolve({ asset: asset(id), inspections: [{ id: 100 + id, status: 'open', severity: 'low', notes: `Existing observation for tower ${id}`, observed_at: '2026-09-29T12:00:00Z', author_name: 'Inspector', events: [], lock_version: 0 }] });
  });
  render(<App />);
  await screen.findByText('Existing observation for tower 1');
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }));
  fireEvent.change(screen.getByLabelText('Observation notes'), { target: { value: 'Saving first asset observation.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save observation' }));
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/assets/1/inspections', expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: /TEST-2/ }));
  await screen.findByText('Existing observation for tower 2');
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }));
  fireEvent.change(screen.getByLabelText('Observation notes'), { target: { value: 'Unsaved draft for second asset.' } });
  await act(async () => { finishSave({}); await save; });
  expect(screen.getByLabelText('Observation notes')).toHaveValue('Unsaved draft for second asset.');
  expect(screen.getByText('Existing observation for tower 2')).toBeInTheDocument();
});
