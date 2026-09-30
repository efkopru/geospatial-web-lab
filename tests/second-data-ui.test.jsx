import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServiceApp from '../01-service-requests/frontend/src/App';
import PortalApp from '../02-data-quality-portal/frontend/src/App';

const shared = vi.hoisted(() => ({ api: vi.fn(), session: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api, useSession: () => shared.session,
  useLive: () => false, usePolling: () => {},
  AppShell: ({ children, actions }) => <main>{actions}{children}</main>,
  Login: () => <div>Login</div>, Stat: () => null, BarChart: () => null, GeoMap: () => null
}));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  shared.session = { user: {id: 1, role: 'staff', name: 'Staff'}, loading: false, logout: vi.fn() };
  shared.api.mockReset().mockImplementation(async path => {
    if (path.startsWith('/api/issues?')) return {issues: [], total_count: 0, counts: {}};
    if (path === '/api/staff') return {staff: []};
    if (path === '/api/import_runs') return {imports: []};
    if (path === '/api/export_runs') return {exports: []};
    if (path === '/datasets') return {datasets: []};
    throw new Error(path);
  });
});
afterEach(cleanup);

it.each(['logout', 'account switch'])('cancels service import file reads after %s', async transition => {
  const view = render(<ServiceApp />);
  fireEvent.click(screen.getByRole('button', {name: 'Imports & reports'}));
  const fileRead = deferred();
  const text = vi.fn(() => fileRead.promise);
  fireEvent.change(screen.getByLabelText('GeoJSON file'), {target: {files: [{size: 100, name: 'private.geojson', text}]}});
  expect(text).toHaveBeenCalledOnce();
  shared.session = {...shared.session, user: transition === 'logout' ? null : {id: 2, role: 'staff', name: 'Other Staff'}};
  view.rerender(<ServiceApp />);
  await act(async () => fileRead.resolve('{"type":"FeatureCollection","features":[]}'));
  expect(shared.api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
});

it('does not issue follow-up staff requests when an obsolete workspace response arrives', async () => {
  const pending = deferred();
  shared.api.mockImplementation(path => path === '/api/staff' ? Promise.resolve({staff: []}) : pending.promise);
  const view = render(<ServiceApp />);
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/issues/)));
  shared.session = {...shared.session, user: null};
  view.rerender(<ServiceApp />);
  await act(async () => pending.resolve({issues: [], total_count: 0, counts: {}}));
  expect(shared.api).not.toHaveBeenCalledWith('/api/import_runs');
  expect(shared.api).not.toHaveBeenCalledWith('/api/export_runs');
});

it('does not refresh datasets after an upload finishes in an unmounted account workspace', async () => {
  const pending = deferred();
  shared.api.mockImplementation(async (path, options) => options?.method === 'POST' ? pending.promise : {datasets: []});
  const view = render(<PortalApp />);
  fireEvent.click(screen.getByRole('button', {name: 'Upload GeoJSON'}));
  fireEvent.change(screen.getByLabelText('Drop a GeoJSON file here or choose a file'), {target: {files: [{size: 2, name: 'private.geojson', text: async () => '{}'}]}});
  await screen.findByText('private.geojson');
  fireEvent.click(screen.getByRole('button', {name: 'Upload and validate'}));
  await waitFor(() => expect(shared.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
  shared.session = {...shared.session, user: null};
  view.rerender(<PortalApp />);
  shared.api.mockClear();
  await act(async () => pending.resolve({dataset: {id: 5}, duplicate: false}));
  expect(shared.api).not.toHaveBeenCalled();
});
