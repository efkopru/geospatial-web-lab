// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../01-service-requests/frontend/src/App';

const shared = vi.hoisted(() => ({ api: vi.fn(), role: 'staff', live: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => ({ user: { id: 1, name: 'Staff', role: shared.role }, loading: false, logout: vi.fn() }),
  useLive: (_channel, callback) => { shared.live = callback; return true; },
  usePolling: () => {},
  AppShell: ({ children, actions }) => <main>{actions}{children}</main>,
  Login: () => <div>Login</div>,
  Stat: ({ label, value }) => <div>{label}: {value}</div>,
  BarChart: () => <div>Chart</div>,
  GeoMap: ({ features, onSelect }) => <div>{features.features.map(feature => <button key={feature.id} onClick={() => onSelect(feature)}>Select marker {feature.id}</button>)}</div>
}));

let issue;
beforeEach(() => {
  shared.role = 'staff';
  issue = { id: 10, title: 'Broken streetlight', description: 'At the crossing', category: 'lighting', status: 'new', latitude: 33.045, longitude: -96.995, reporter: { id: 2, name: 'Reporter' }, assigned_to: null, lock_version: 0, created_at: '2026-09-29T12:00:00Z', updated_at: '2026-09-29T12:00:00Z' };
  shared.api.mockReset();
  shared.api.mockImplementation(async (path, options) => {
    if (path.startsWith('/api/issues?')) return { issues: [issue], total_count: 1, counts: { [issue.status]: 1 } };
    if (path === '/api/staff') return { staff: [{ id: 1, name: 'Staff' }] };
    if (path === '/api/import_runs') return { imports: [] };
    if (path === '/api/export_runs') return { exports: [] };
    if (path === '/api/issues/10' && options?.method === 'PATCH') {
      issue = { ...issue, ...options.body.issue, lock_version: 1, assigned_to: { id: 1, name: 'Staff' } };
      return { issue };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
});
afterEach(cleanup);

describe('service request workflow', () => {
  it('selects a mapped request and submits its assignment with an optimistic lock', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select marker 10' }));
    fireEvent.change(await screen.findByLabelText('Staff member'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/issues/10', {
      method: 'PATCH', body: { issue: { assigned_to_id: '1', status: 'assigned', lock_version: 0 } }
    }));
  });

  it('preserves a stale draft and requires reloading before staff can overwrite a live update', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select marker 10' }));
    await screen.findByLabelText('Staff member');
    issue = { ...issue, status: 'assigned', lock_version: 1, assigned_to: { id: 1, name: 'Staff' } };
    await act(async () => { await shared.live(); });
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Load current values' }));
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(false);
    expect(screen.getByLabelText('Staff member').value).toBe('1');
  });

  it('keeps staff controls out of the reporter interface', async () => {
    shared.role = 'reporter';
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select marker 10' }));
    expect(screen.queryByRole('button', { name: 'Imports & reports' })).toBeNull();
    expect(screen.queryByLabelText('Staff member')).toBeNull();
    expect(screen.getByRole('button', { name: '+ New request' })).toBeTruthy();
    expect(shared.api).not.toHaveBeenCalledWith('/api/staff');
  });
});
