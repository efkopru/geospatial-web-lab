import { test, expect } from '@playwright/test';

test.setTimeout(90000);

async function login(page, port, email = 'staff@example.test') {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Learning123!');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test('service requests persist and status changes reach a second authenticated browser live', async ({ browser }) => {
  const staffContext = await browser.newContext();
  const reporterContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const reporter = await reporterContext.newPage();
  const title = `Browser verified streetlight ${Date.now()}`;
  const frames = { staff: [], reporter: [] };
  for (const [name, page] of [['staff', staff], ['reporter', reporter]]) {
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      try { const data = JSON.parse(payload.toString()); if (data.message?.type === 'issue_changed') frames[name].push(data.message); } catch { /* Non-JSON protocol messages are irrelevant to the assertion. */ }
    }));
  }
  try {
    await login(staff, 5171);
    await login(reporter, 5171, 'reporter@example.test');
    await expect(staff.getByText('Live updates connected', { exact: false })).toBeVisible();
    await expect(reporter.getByText('Live updates connected', { exact: false })).toBeVisible();
    await reporter.getByRole('button', { name: '+ New request' }).click();
    const form = reporter.getByRole('dialog');
    await form.getByLabel('Title', { exact: true }).fill(title);
    await form.getByLabel('Category', { exact: true }).selectOption('lighting');
    await form.getByLabel('Description', { exact: true }).fill('Synthetic request created by a browser integration test.');
    const createResponse = reporter.waitForResponse(response => response.url().endsWith('/api/issues') && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Create request', exact: true }).click();
    const created = await (await createResponse).json();
    await expect(form).not.toBeVisible();
    const requestButton = staff.getByRole('button', { name: new RegExp(title) });
    // This deadline is shorter than the 15-second polling interval, proving delivery over Action Cable.
    await expect(requestButton).toBeVisible({ timeout: 8000 });
    await expect.poll(() => frames.staff.some(frame => frame.id === created.issue.id), { timeout: 8000 }).toBe(true);
    await requestButton.click();
    await staff.getByLabel('Staff member', { exact: true }).selectOption({ label: 'Alex Morgan' });
    await staff.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(reporter.locator('.sr-detail .sr-status')).toHaveText('Assigned', { timeout: 8000 });
    for (const [status, label] of [['in_progress', 'In progress'], ['resolved', 'Resolved']]) {
      await staff.locator('.sr-detail').getByLabel('Status', { exact: true }).selectOption(status);
      await staff.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(reporter.locator('.sr-detail .sr-status')).toHaveText(label, { timeout: 8000 });
    }
    await reporter.reload();
    await reporter.getByRole('button', { name: new RegExp(title) }).click();
    await expect(reporter.locator('.sr-detail .sr-status')).toHaveText('Resolved');
    await expect(reporter.getByLabel('Staff member', { exact: true })).toHaveCount(0);
    await expect(reporter.getByRole('button', { name: 'Imports & reports' })).toHaveCount(0);
  } finally {
    await Promise.allSettled([staffContext.close(), reporterContext.close()]);
  }
});

test('service import jobs reject invalid rows, deduplicate uploads, and produce downloadable reports', async ({ page }) => {
  await login(page, 5171);
  await page.getByRole('button', { name: 'Imports & reports' }).click();
  const title = `Browser import ${Date.now()}`;
  const payload = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-96.995, 33.045] }, properties: { title, category: 'roads' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-96.995, 100] }, properties: { title: `${title} rejected`, category: 'roads' } }
  ] }));
  const upload = { name: 'browser-test.geojson', mimeType: 'application/geo+json', buffer: payload };
  const importResponse = page.waitForResponse(response => response.url().endsWith('/api/import_runs') && response.request().method() === 'POST');
  await page.getByLabel('GeoJSON file').setInputFiles(upload);
  const importedResponse = await importResponse;
  expect(importedResponse.status()).toBe(202);
  const imported = await importedResponse.json();
  expect(imported.reused).toBe(false);
  const importPanel = page.locator('.sr-tools > section').first();
  const importJob = importPanel.locator('.sr-job').filter({ has: page.getByText(`Import #${imported.import.id}`, { exact: true }) });
  await expect(importJob).toHaveCount(1);
  await expect(importJob).toContainText('completed', { timeout: 20000 });
  await expect(importJob).toContainText('1 imported · 1 rejected · 2/2 processed');
  await expect(page.getByLabel('GeoJSON file')).toBeEnabled();
  const duplicateResponse = page.waitForResponse(response => response.url().endsWith('/api/import_runs') && response.request().method() === 'POST');
  await page.getByLabel('GeoJSON file').setInputFiles(upload);
  const reusedResponse = await duplicateResponse;
  expect(reusedResponse.status()).toBe(200);
  const reused = await reusedResponse.json();
  expect(reused.reused).toBe(true);
  expect(reused.import.id).toBe(imported.import.id);
  await expect(importJob).toHaveCount(1);
  await expect(page.getByText(/already exists\. No duplicate requests were created/)).toBeVisible();
  const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/export_runs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generate CSV report' }).click();
  const exportedResponse = await exportResponse;
  expect(exportedResponse.status()).toBe(202);
  const exported = await exportedResponse.json();
  const reportPanel = page.locator('.sr-tools > section').nth(1);
  const reportJob = reportPanel.locator('.sr-job').filter({ has: page.getByText(`Report #${exported.export.id}`, { exact: true }) });
  await expect(reportJob).toHaveCount(1);
  await expect(reportJob).toContainText('completed', { timeout: 20000 });
  const downloadLink = reportJob.getByRole('link', { name: 'Download CSV' });
  await expect(downloadLink).toBeVisible({ timeout: 20000 });
  await expect(downloadLink).toHaveAttribute('href', `/api/export_runs/${exported.export.id}/download`);
  const response = await page.request.get(new URL(await downloadLink.getAttribute('href'), page.url()).href);
  expect(response.ok()).toBeTruthy();
  const report = await response.text();
  expect(report).toContain(title);
  expect(report).not.toContain(`${title} rejected`);
  expect(report.split(title).length - 1).toBe(1);
});

test('fleet replay records telemetry, detects geofence entries, and stops when paused', async ({ page }) => {
  await login(page, 5173);
  await page.getByRole('button', { name: 'Reset replay', exact: true }).click();
  await expect(page.getByText('Replay paused', { exact: true })).toBeVisible();
  const zoneName = `Browser coverage ${Date.now()}`;
  await page.getByRole('button', { name: 'Add zone', exact: true }).click();
  await page.getByLabel('Zone name', { exact: true }).fill(zoneName);
  await page.getByLabel('West', { exact: true }).fill('-97');
  await page.getByLabel('South', { exact: true }).fill('32');
  await page.getByLabel('East', { exact: true }).fill('-96');
  await page.getByLabel('North', { exact: true }).fill('33');
  await page.getByRole('button', { name: 'Create rectangular zone', exact: true }).click();
  await expect(page.locator('.fleet-zones').getByText(zoneName, { exact: true })).toBeVisible();
  await page.getByLabel('Replay speed').selectOption('4');
  await page.getByRole('button', { name: 'Start replay', exact: true }).click();
  await expect(page.getByText('Replay running', { exact: true })).toBeVisible();
  await expect(page.getByText('10 / 10', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.fleet-zones li').filter({ hasText: zoneName })).toContainText('10 vehicles inside');
  await expect(page.locator('.fleet-events tbody tr').filter({ hasText: zoneName }).first()).toContainText('enter');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Replay paused', { exact: true })).toBeVisible();
  const snapshot = await (await page.request.get('http://127.0.0.1:5173/api/fleet')).json();
  expect(snapshot.replay.running).toBe(false);
  expect(snapshot.replay.sequence).toBeGreaterThan(0);
  expect(snapshot.vehicles.every(vehicle => vehicle.longitude !== null)).toBe(true);
  // A scheduled tick is due after one second. Pausing must invalidate that queued generation.
  await page.waitForTimeout(1800);
  const afterPause = await (await page.request.get('http://127.0.0.1:5173/api/fleet')).json();
  expect(afterPause.replay.sequence).toBe(snapshot.replay.sequence);
  await page.reload();
  await expect(page.getByText('Replay paused', { exact: true })).toBeVisible();
  await expect(page.getByText('10 / 10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Remove ${zoneName}`, exact: true }).click();
  await expect(page.locator('.fleet-zones').getByText(zoneName, { exact: true })).toHaveCount(0);
});
