import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStandalone } from '../shared/runtime.js';
import { AppShell, useSession } from '../shared/index.jsx';
import { seed as qualitySeed, handle as qualityHandle } from '../02-data-quality-portal/src/local-api.js';

let runtime;
let createObjectURL;
let revokeObjectURL;
let clickedDownloads;
const NativeURL = globalThis.URL;

beforeEach(() => {
  clickedDownloads = [];
  createObjectURL = vi.fn(() => 'blob:http://localhost/local-export');
  revokeObjectURL = vi.fn();
  // jsdom has no object-URL implementation. Keep real URL parsing and capture
  // only the boundary where the runtime hands a Blob to the browser.
  class URLWithBlobs extends NativeURL {}
  URLWithBlobs.createObjectURL = createObjectURL;
  URLWithBlobs.revokeObjectURL = revokeObjectURL;
  vi.stubGlobal('URL', URLWithBlobs);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    clickedDownloads.push({ href: this.getAttribute('href'), filename: this.download, connected: this.isConnected });
  });
});

afterEach(() => {
  cleanup();
  runtime?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ href = '/api/datasets/1/export' }) {
  const session = useSession();
  if (session.loading) return <p>Opening local data</p>;
  return <AppShell title="Download integration" user={session.user} onLogout={session.logout}>
    <a href={href} download><span>Download approved GeoJSON</span></a>
  </AppShell>;
}

function clickDownload() {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  // Start from a nested label so the document interceptor must find its anchor.
  fireEvent(screen.getByText('Download approved GeoJSON'), event);
  return event;
}

function blobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('local export links', () => {
  it('intercepts an /api anchor and downloads the exact approved snapshot with one Blob anchor click', async () => {
    const handle = vi.fn(qualityHandle);
    runtime = configureStandalone({ id: `download-${crypto.randomUUID()}`, seed: qualitySeed, handle });
    await runtime.ready;
    const expected = runtime.read().datasets[0].version.export_json;
    render(<Harness />);

    const event = clickDownload();
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ path: '/api/datasets/1/export', method: 'GET' });
    expect(handle.mock.calls[0][0].query).toBeInstanceOf(URLSearchParams);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/geo+json');
    expect(await blobText(blob)).toBe(expected);
    expect(clickedDownloads).toEqual([{ href: 'blob:http://localhost/local-export', filename: 'dataset-1-v1.geojson', connected: true }]);
    expect(document.querySelectorAll('a[href^="blob:"]')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(runtime.meta.error).toBe('');
    // Wait for the real delayed revocation before restoring the browser stub.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/local-export'), { timeout: 2000 });
  });

  it('prevents navigation and displays the actual adapter rejection instead of creating a download', async () => {
    const handle = vi.fn(qualityHandle);
    runtime = configureStandalone({ id: `download-blocked-${crypto.randomUUID()}`, seed: qualitySeed, handle });
    await runtime.ready;
    render(<Harness href="/api/datasets/2/export" />);

    expect(clickDownload().defaultPrevented).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Approve the dataset before exporting');
    expect(runtime.meta.error).toBe('Approve the dataset before exporting');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedDownloads).toHaveLength(0);
  });

  it('shows a failed or missing export response through shared meta.error without a broken navigation', async () => {
    const handle = vi.fn(() => ({ dataset: { status: 'ready' } }));
    runtime = configureStandalone({ id: `download-missing-${crypto.randomUUID()}`, seed: () => ({ records: [] }), handle });
    await runtime.ready;
    render(<Harness />);

    expect(clickDownload().defaultPrevented).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('This download is unavailable.');
    expect(runtime.meta.error).toBe('This download is unavailable.');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedDownloads).toHaveLength(0);
  });
});
