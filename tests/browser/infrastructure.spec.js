import { test, expect } from '@playwright/test';

test.setTimeout(120000);

async function login(page, email) {
  await page.goto('http://127.0.0.1:5175');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Inspect in context.' })).toBeVisible();
}

test('Cesium corridor, shared observations, private profile job and export', async ({ browser }) => {
  const staffContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const reporterContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const reporter = await reporterContext.newPage();
  const errors = [];
  const cable = [];
  const staffProfiles = [];
  const reporterProfiles = [];
  staff.on('pageerror', (error) => errors.push(error.message));
  reporter.on('pageerror', (error) => errors.push(error.message));
  staff.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      const frame = JSON.parse(payload.toString());
      if (frame.message?.type === 'inspection.updated') cable.push(frame.message);
      if (frame.message?.type === 'profile.updated') staffProfiles.push(frame.message);
    } catch { /* Ignore protocol pings. */ }
  }));
  reporter.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { const frame = JSON.parse(payload.toString()); if (frame.message?.type === 'profile.updated') reporterProfiles.push(frame.message); } catch { /* Ignore protocol pings. */ }
  }));
  try {
    await login(staff, 'staff@example.test');
    await login(reporter, 'reporter@example.test');
    await expect(staff.locator('.cesium-widget canvas')).toBeVisible();
    await expect(staff.locator('.corridor-webgl-error')).toHaveCount(0);
    await expect(staff.locator('.inspection-asset')).toHaveCount(8);
    await staff.getByLabel('Height display').selectOption('3');
    await expect(staff.locator('.corridor-map-caption')).toContainText('Height display 3×');
    const note = `Synthetic browser inspection ${Date.now()}: verify the fastener assembly.`;
    await reporter.getByRole('button', { name: 'Add observation', exact: true }).click();
    await reporter.getByLabel('Severity', { exact: true }).selectOption('high');
    await reporter.getByLabel('Observation notes', { exact: true }).fill(note);
    await reporter.getByRole('button', { name: 'Save observation', exact: true }).click();
    const reporterCard = reporter.locator('.inspection-card').filter({ hasText: note });
    await expect(reporterCard).toBeVisible();
    await expect(reporterCard.getByRole('button', { name: 'Resolve observation' })).toHaveCount(0);
    const staffCard = staff.locator('.inspection-card').filter({ hasText: note });
    await expect(staffCard).toBeVisible({ timeout: 10000 });
    await expect.poll(() => cable.length).toBeGreaterThan(0);
    await staffCard.getByRole('button', { name: 'Resolve observation' }).click();
    await staffCard.getByLabel('Resolution notes', { exact: true }).fill('Synthetic verification completed; fasteners are secure.');
    await staffCard.getByRole('button', { name: 'Save status change' }).click();
    await expect(reporterCard.locator('.badge')).toHaveText('resolved');
    const [created] = await Promise.all([
      staff.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/profile_runs'),
      staff.getByRole('button', { name: 'Generate profile' }).click()
    ]);
    expect(created.status()).toBe(202);
    const runId = (await created.json()).profile_run.id;
    await expect(staff.getByLabel('Profile run', { exact: true })).toHaveValue(String(runId));
    await expect(staff.locator('.inspection-job')).toContainText('completed', { timeout: 30000 });
    await expect(staff.getByRole('img', { name: /Synthetic base elevation profile/ })).toBeVisible();
    await expect.poll(() => staffProfiles.some((message) => message.id === runId && message.status === 'completed')).toBe(true);
    const reporterRuns = await reporterContext.request.get('http://127.0.0.1:5175/api/profile_runs');
    expect(reporterRuns.status()).toBe(200);
    expect((await reporterRuns.json()).profile_runs.some((run) => run.id === runId)).toBe(false);
    for (const suffix of ['', '/download']) {
      const denied = await reporterContext.request.get(`http://127.0.0.1:5175/api/profile_runs/${runId}${suffix}`);
      expect(denied.status()).toBe(404);
    }
    const reporterSession = await (await reporterContext.request.get('http://127.0.0.1:5175/api/session')).json();
    const deniedRetry = await reporterContext.request.post(`http://127.0.0.1:5175/api/profile_runs/${runId}/retry`, {
      headers: { 'X-CSRF-Token': reporterSession.csrf_token }, data: {}
    });
    expect(deniedRetry.status()).toBe(404);
    await expect(reporter.locator(`.inspection-profile option[value="${runId}"]`)).toHaveCount(0);
    expect(reporterProfiles.some((message) => message.id === runId)).toBe(false);
    const [download] = await Promise.all([staff.waitForEvent('download'), staff.getByRole('link', { name: 'Download profile GeoJSON' }).click()]);
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk.toString();
    const document = JSON.parse(text);
    expect(document.type).toBe('FeatureCollection');
    expect(document.features).toHaveLength(71);
    expect(document.metadata.assets).toHaveLength(8);
    expect(document.metadata.source).toContain('SYNTHETIC');
    await staff.locator('.inspection-asset').filter({ hasText: 'T-201' }).click();
    await expect(staff.getByRole('heading', { name: 'Ridge transmission tower', exact: true })).toBeVisible();
    await staff.getByRole('button', { name: 'Focus in 3D' }).click();
    await staff.getByRole('button', { name: 'View full corridor' }).click();
    await staff.screenshot({ path: '.runtime/infrastructure-desktop.png', fullPage: true });
    await staff.setViewportSize({ width: 390, height: 844 });
    await expect(staff.locator('.cesium-widget canvas')).toBeVisible();
    expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    await staff.screenshot({ path: '.runtime/infrastructure-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([staffContext.close(), reporterContext.close()]);
  }
});
