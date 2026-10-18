import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServiceApp from '../01-service-requests/frontend/src/App';
import PortalApp from '../02-data-quality-portal/frontend/src/App';

const shared = vi.hoisted(() => ({ api: vi.fn(), session: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => shared.session,
  useLive: () => true,
  usePolling: () => {},
  AppShell: ({ children, actions }) => <main>{actions}{children}</main>,
  Login: () => <div>Login</div>,
  Stat: () => null,
  BarChart: () => null,
  GeoMap: () => null,
  downloadJson: () => {}
}));

const importRun = (overrides) => ({ id: 7, status: 'processing', abandoned: false, imported_count: 1, processed_count: 1, total_count: 2, errors: [], failure: null, created_at: '2026-10-17T10:00:00Z', ...overrides });
const dataset = (overrides) => ({ id: 4, name: 'Parks', status: 'validating', abandoned: false, total_count: 10, processed_count: 3, valid_count: 3, invalid_count: 0, required_attributes: ['asset_id'], failure_message: null, updated_at: '2026-10-17T10:00:00Z', owner: 'Reporter', version: null, ...overrides });

beforeEach(() => {
  shared.session = { user: { id: 1, name: 'Staff', role: 'staff' }, loading: false, logout: vi.fn() };
  shared.api.mockReset();
});
afterEach(cleanup);

const serviceApi = (imports) => async (path, options) => {
  if (options?.method === 'POST') return { import: importRun({ status: 'pending' }) };
  if (path.startsWith('/api/issues?')) return { issues: [], total_count: 0, counts: {} };
  if (path === '/api/staff') return { staff: [] };
  if (path === '/api/import_runs') return { imports };
  if (path === '/api/export_runs') return { exports: [] };
  throw new Error(path);
};

it('offers to resume an abandoned import, and nothing for one still processing', async () => {
  shared.api.mockImplementation(serviceApi([importRun({ abandoned: true }), importRun({ id: 8 })]));
  render(<ServiceApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Imports & reports' }));
  const resume = await screen.findByRole('button', { name: 'Resume import' });
  expect(screen.getAllByRole('button', { name: /Resume import|Retry import/ })).toHaveLength(1);
  expect(screen.getByText(/Processing stopped before it finished/)).toBeInTheDocument();
  fireEvent.click(resume);
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/import_runs/7/retry', { method: 'POST' }));
});

it('offers to resume an abandoned validation', async () => {
  shared.api.mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return { dataset: dataset({ status: 'queued', abandoned: false }) };
    if (path === '/datasets' || path.startsWith('/datasets?')) return { datasets: [dataset({ abandoned: true })] };
    return { ...dataset({ abandoned: true }), records: [] };
  });
  render(<PortalApp />);
  const resume = await screen.findByRole('button', { name: 'Resume validation' }, { timeout: 5000 });
  expect(screen.getByText(/Validation stopped before it finished/)).toBeInTheDocument();
  fireEvent.click(resume);
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/datasets/4/retry', { method: 'POST' }));
});
