import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStandalone } from '../shared/runtime.js';
import { AppShell, useSession } from '../shared/index.jsx';

let runtime;
afterEach(() => { cleanup(); runtime?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness() {
  const session = useSession();
  if (session.loading) return <p>Loading session</p>;
  return <AppShell title="Restore test" user={session.user} onLogout={session.logout}><p>Ready</p></AppShell>;
}
function chooseFile(content, name = 'backup.json') {
  const file = new File([content], name, { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
}
async function open(id) {
  runtime = configureStandalone({ id, seed: () => ({ count: 0, rows: [] }), handle: () => ({}) });
  render(<Harness />);
  await screen.findByText('Ready');
}

describe('local backup restore', () => {
  it('confirms a valid backup before replacing local data, then reloads', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, hostname: 'example.test', reload });
    const id = 'restore-' + crypto.randomUUID();
    await open(id);
    await runtime.mutate(state => { state.count = 3; });
    const backup = { format: 'geospatial-web-lab-standalone-backup', exportedAt: '2026-09-30T12:00:00.000Z', version: 1, app: id, state: { count: 42, rows: [{ id: 1 }] } };
    chooseFile(JSON.stringify(backup), 'saved.json');
    const dialog = await screen.findByRole('alertdialog', { name: 'Restore standalone backup' });
    expect(dialog).toHaveTextContent('saved.json');
    expect(dialog).toHaveTextContent('Current local edits are discarded');
    expect(runtime.read().count).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(runtime.read().count).toBe(3);

    chooseFile(JSON.stringify(backup), 'saved.json');
    fireEvent.click(await screen.findByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(runtime.read()).toEqual({ count: 42, rows: [{ id: 1 }] });
  });

  it('disables the backup and reset controls while a restore is in progress', async () => {
    const id = 'restore-busy-' + crypto.randomUUID();
    await open(id);
    let finish;
    vi.spyOn(runtime, 'restore').mockImplementation(() => new Promise((_resolve, reject) => { finish = reject; }));
    chooseFile(JSON.stringify({ format: 'geospatial-web-lab-standalone-backup', version: 1, app: id, state: { count: 1, rows: [] } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset demo data' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Restore local backup' })).toBeDisabled();
    expect(screen.getByLabelText('Backup file')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish(new Error('Storage failed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage failed');
    expect(screen.getByRole('button', { name: 'Reset demo data' })).toBeEnabled();
  });

  it('shows an error and keeps local data for invalid JSON or another app\'s backup', async () => {
    const id = 'restore-invalid-' + crypto.randomUUID();
    await open(id);
    await runtime.mutate(state => { state.count = 7; });
    chooseFile('{not json');
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not valid JSON.');
    chooseFile(JSON.stringify({ format: 'geospatial-web-lab-standalone-backup', version: 1, app: '03-fleet-monitor', state: {} }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(`belongs to 03-fleet-monitor, not ${id}`));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(runtime.read().count).toBe(7);
  });
});
