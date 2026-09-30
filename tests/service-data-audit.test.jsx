import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServiceApp from '../01-service-requests/frontend/src/App';
import PortalApp from '../02-data-quality-portal/frontend/src/App';

const shared = vi.hoisted(() => ({ api: vi.fn(), session: null, live: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => shared.session,
  useLive: (_channel, callback) => { shared.live = callback; return true; },
  usePolling: () => {},
  AppShell: ({ children, actions }) => <main>{actions}{children}</main>,
  Login: () => <div>Login</div>,
  Stat: ({ label, value }) => <div>{label}: {value}</div>,
  BarChart: () => <div>Chart</div>,
  GeoMap: ({ features, onSelect }) => <div>{features.features.map(feature => <button key={feature.id} onClick={() => onSelect(feature)}>Select marker {feature.id}</button>)}</div>
}));

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const uploadField = () => screen.getByLabelText('Drop a GeoJSON file here or choose a file');
const file = (name, text, size = text.length) => ({ name, size, text: vi.fn().mockResolvedValue(text) });

beforeEach(() => {
  shared.session = { user: { id: 1, name: 'Staff', role: 'staff' }, loading: false, logout: vi.fn() };
  shared.api.mockReset().mockResolvedValue({ datasets: [] });
});
afterEach(cleanup);

it('keeps the newly selected service request draft intact when an older save finishes', async () => {
  let issues = [
    { id: 10, title: 'First request', category: 'roads', description: '', status: 'new', assigned_to: null, reporter: { name: 'Reporter' }, latitude: 33, longitude: -97, lock_version: 0 },
    { id: 11, title: 'Second request', category: 'roads', description: '', status: 'in_progress', assigned_to: { id: 2, name: 'Other staff' }, reporter: { name: 'Reporter' }, latitude: 33, longitude: -97, lock_version: 1 }
  ];
  const save = deferred();
  shared.api.mockImplementation(async (path, options) => {
    if (path.startsWith('/api/issues?')) return { issues, total_count: 2, counts: {} };
    if (path === '/api/staff') return { staff: [{ id: 1, name: 'Staff' }, { id: 2, name: 'Other staff' }] };
    if (path === '/api/import_runs') return { imports: [] };
    if (path === '/api/export_runs') return { exports: [] };
    if (path === '/api/issues/10' && options?.method === 'PATCH') return save.promise;
    throw new Error(path);
  });
  render(<ServiceApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Select marker 10' }));
  fireEvent.change(await screen.findByLabelText('Staff member'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/issues/10', expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: 'Select marker 11' }));
  await waitFor(() => expect(screen.getByLabelText('Staff member')).toHaveValue('2'));
  issues = [{ ...issues[0], status: 'assigned', assigned_to: { id: 1, name: 'Staff' }, lock_version: 1 }, issues[1]];
  await act(async () => save.resolve({ issue: issues[0] }));
  expect(screen.getByLabelText('Staff member')).toHaveValue('2');
  expect(screen.getByLabelText('Status', { selector: '[aria-label="Status"]' })).toHaveValue('in_progress');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

it('invalid replacement files clear the previous upload instead of submitting stale content', async () => {
  render(<PortalApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload GeoJSON' }));
  fireEvent.change(uploadField(), { target: { files: [file('first.geojson', '{"type":"FeatureCollection","features":[]}')] } });
  expect(await screen.findByText('first.geojson')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload and validate' })).toBeEnabled();
  fireEvent.change(uploadField(), { target: { files: [file('broken.geojson', '{invalid')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON');
  expect(screen.queryByText('first.geojson')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload and validate' })).toBeDisabled();
  expect(screen.getByLabelText('Dataset name')).toHaveValue('');
});

it('the most recently selected file wins when file reads complete out of order', async () => {
  render(<PortalApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload GeoJSON' }));
  const slow = deferred();
  fireEvent.change(uploadField(), { target: { files: [{ name: 'slow.geojson', size: 10, text: () => slow.promise }] } });
  fireEvent.change(uploadField(), { target: { files: [file('latest.geojson', '{}')] } });
  expect(await screen.findByText('latest.geojson')).toBeInTheDocument();
  await act(async () => slow.resolve('{}'));
  expect(screen.queryByText('slow.geojson')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Dataset name')).toHaveValue('latest');
});

it('switching accounts discards private upload drafts', async () => {
  const view = render(<PortalApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload GeoJSON' }));
  fireEvent.change(uploadField(), { target: { files: [file('private.geojson', '{"private":"source"}')] } });
  expect(await screen.findByText('private.geojson')).toBeInTheDocument();
  shared.session = { ...shared.session, user: { id: 2, name: 'Other user', role: 'reporter' } };
  view.rerender(<PortalApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload GeoJSON' }));
  expect(screen.queryByText('private.geojson')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Dataset name')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Upload and validate' })).toBeDisabled();
});

it('late dataset list responses cannot overwrite a newer refresh', async () => {
  render(<PortalApp />);
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/datasets'));
  const first = deferred();
  const second = deferred();
  shared.api.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  let firstRefresh; let secondRefresh;
  act(() => { firstRefresh = shared.live(); secondRefresh = shared.live(); });
  await act(async () => { second.resolve({ datasets: [] }); await secondRefresh; });
  await act(async () => {
    first.resolve({ datasets: [{ id: 4, name: 'Stale dataset', status: 'queued', total_count: 1, invalid_count: 0, owner: 'Staff' }] });
    await firstRefresh;
  });
  expect(screen.queryByText('Stale dataset')).not.toBeInTheDocument();
});
