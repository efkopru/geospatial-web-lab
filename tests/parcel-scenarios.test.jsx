import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../04-parcel-scenarios/frontend/src/App';

const shared = vi.hoisted(() => ({ api: vi.fn(), session: null, live: null }));
vi.mock('@geo/shared', () => ({
  api: shared.api,
  useSession: () => shared.session,
  useLive: (_channel, callback) => { shared.live = callback; return true; },
  usePolling: () => {},
  Loading: () => <div>Loading</div>,
  Login: () => <div>Login</div>,
  AppShell: ({ children }) => <main>{children}</main>,
  Stat: ({ label, value }) => <div>{label}: {value}</div>,
  BarChart: () => <div>Chart</div>,
  GeoMap: () => <div>Map</div>,
  Notice: ({ children, error }) => children ? <div role={error ? 'alert' : 'status'}>{children}</div> : null
}));

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const parcel = { id: 7, type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { title: 'Block A', district: 'River district', area_acres: 1, height_limit: 4 } };
const scenario = { id: 4, name: 'Private concept', status: 'complete', floors: 4, coverage: 0.5, results: { units: 32, gross_floor_area_sqft: 40000, floor_area_ratio: 2, warnings: [] } };

beforeEach(() => {
  shared.session = { user: { id: 1, name: 'Planner', role: 'staff' }, loading: false, logout: vi.fn() };
  shared.api.mockReset().mockImplementation(async path => {
    if (path === '/api/parcels') return { features: [parcel] };
    if (path === '/api/scenarios') return [];
    throw new Error(path);
  });
});
afterEach(cleanup);

async function selectParcel() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Block A' }));
}

it('reports a saved but failed enqueue instead of claiming that processing was queued', async () => {
  const failed = { ...scenario, status: 'failed', results: {}, error_message: 'Background queue is unavailable. Retry when restored.' };
  shared.api.mockImplementation(async (path, options) => {
    if (path === '/api/parcels') return { features: [parcel] };
    if (path === '/api/scenarios' && options?.method === 'POST') return failed;
    if (path === '/api/scenarios') return [];
    throw new Error(path);
  });
  render(<App />);
  await selectParcel();
  fireEvent.click(screen.getByRole('button', { name: 'Calculate 1 selected parcels' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(failed.error_message);
  expect(screen.queryByText(/Scenario queued/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Calculate 1 selected parcels' })).toBeEnabled());
});

it('ignores an older refresh that would replace the latest completed scenario list', async () => {
  render(<App />);
  await screen.findByRole('checkbox', { name: 'Select Block A' });
  const older = deferred(); const newer = deferred();
  let requests = 0;
  shared.api.mockImplementation(path => path === '/api/parcels' ? Promise.resolve({ features: [parcel] }) : (++requests === 1 ? older.promise : newer.promise));
  let first; let second;
  act(() => { first = shared.live(); second = shared.live(); });
  await act(async () => { newer.resolve([scenario]); await second; });
  expect(screen.getByText('Private concept')).toBeInTheDocument();
  await act(async () => { older.resolve([]); await first; });
  expect(screen.getByText('Private concept')).toBeInTheDocument();
});

it('account changes immediately clear private scenario rows and design drafts', async () => {
  shared.api.mockImplementation(async path => path === '/api/parcels' ? { features: [parcel] } : [scenario]);
  const view = render(<App />);
  expect(await screen.findByText('Private concept')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Scenario name'), { target: { value: 'Private draft assumptions' } });
  await selectParcel();
  const pending = deferred();
  shared.api.mockImplementation(() => pending.promise);
  shared.session = { ...shared.session, user: { id: 2, name: 'Second planner', role: 'reporter' } };
  view.rerender(<App />);
  expect(screen.queryByText('Private concept')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Scenario name')).toHaveValue('New courtyard concept');
  expect(screen.getByRole('button', { name: 'Calculate 0 selected parcels' })).toBeDisabled();
});

it('an in-flight save from an unmounted account does not start another refresh', async () => {
  const pendingSave = deferred();
  shared.api.mockImplementation((path, options) => {
    if (path === '/api/parcels') return Promise.resolve({ features: [parcel] });
    if (options?.method === 'POST') return pendingSave.promise;
    return Promise.resolve([]);
  });
  const view = render(<App />);
  await selectParcel();
  fireEvent.click(screen.getByRole('button', { name: 'Calculate 1 selected parcels' }));
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/scenarios', expect.objectContaining({ method: 'POST' })));
  const callsBeforeUnmount = shared.api.mock.calls.length;
  view.unmount();
  await act(async () => pendingSave.resolve({ ...scenario, status: 'queued' }));
  expect(shared.api).toHaveBeenCalledTimes(callsBeforeUnmount);
});

it('retry queue failures remain visible and do not claim success', async () => {
  const failed = { ...scenario, status: 'failed', results: {}, error_message: 'Initial failure' };
  shared.api.mockImplementation(async (path, options) => {
    if (path === '/api/parcels') return { features: [parcel] };
    if (options?.method === 'POST') return { ...failed, error_message: 'Queue remains unavailable.' };
    return [failed];
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Queue remains unavailable.');
});
