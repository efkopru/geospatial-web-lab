import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

// Real API + Sidekiq + PostGIS browser verification. This intentionally creates
// one persistent synthetic dataset and immutable approved version per run.
export async function runDataPortalWorkflow({ screenshotPath } = {}) {
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = path.join(projectRoot, 'frontend', 'test-results');
await mkdir(outputDirectory, { recursive: true });
const source = JSON.parse(await readFile(path.join(projectRoot, 'backend', 'samples', 'parks-with-errors.geojson'), 'utf8'));
const suffix = randomUUID().slice(0, 8);
source.features[0].properties.asset_id += `-${suffix}`;
const name = `Browser review ${suffix}`;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const reporterContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const staffContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const reporter = await reporterContext.newPage();
const staff = await staffContext.newPage();
reporter.setDefaultTimeout(15000);
staff.setDefaultTimeout(15000);
const errors = [];
const failedRequests = [];
const liveMessages = [];
reporter.on('pageerror', error => errors.push(error.message));
reporter.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
staff.on('pageerror', error => errors.push(error.message));
reporter.on('websocket', socket => socket.on('framereceived', frame => liveMessages.push(String(frame.payload))));
const baseURL = process.env.DATA_QUALITY_URL || 'http://127.0.0.1:5172';

try {
  await reporter.goto(baseURL);
  await reporter.getByLabel('Email', { exact: true }).fill('reporter@example.test');
  await reporter.getByRole('button', { name: 'Open workspace' }).click();
  await expect(reporter.getByRole('heading', { name: 'Dataset library' })).toBeVisible();
  await reporter.getByRole('button', { name: 'Upload GeoJSON', exact: true }).click();
  await reporter.locator('input[type="file"]').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(reporter.getByLabel('Dataset name', { exact: true })).toHaveValue(name);
  await reporter.getByRole('button', { name: 'Upload and validate', exact: true }).click();
  await expect(reporter.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(reporter.getByText('Ready for review', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(reporter.getByRole('button', { name: 'Approve valid features' })).toHaveCount(0);
  await reporter.getByRole('combobox', { name: /Show/ }).selectOption('invalid');
  await expect(reporter.locator('tbody tr')).toHaveCount(4);
  await expect(reporter.getByText(/Required attribute 'asset_id' is missing or blank/)).toBeVisible();
  await expect(reporter.getByText(/Invalid geometry: Self-intersection/)).toBeVisible();
  await expect(reporter.getByText('Latitude must be between -90 and 90', { exact: true })).toBeVisible();
  await reporter.getByRole('button', { name: 'Inspect record 3', exact: true }).click();
  await expect(reporter.getByText('Source GeoJSON, record 3', { exact: true })).toBeVisible();

  await staff.goto(baseURL);
  await staff.getByRole('button', { name: 'Open workspace' }).click();
  await staff.getByRole('button', { name: new RegExp(name) }).click();
  await expect(staff.getByRole('heading', { name, exact: true })).toBeVisible();
  const approve = staff.getByRole('button', { name: 'Approve valid features' });
  await expect(approve).toBeDisabled();
  await staff.getByRole('checkbox', { name: /I acknowledge that 4 rejected features/ }).check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(staff.getByRole('link', { name: 'Download approved GeoJSON' })).toBeVisible();
  await expect(reporter.getByRole('link', { name: 'Download approved GeoJSON' })).toBeVisible({ timeout: 10000 });
  expect(liveMessages.some(message => message.includes('approved') && message.includes('dataset_id'))).toBeTruthy();

  const [download] = await Promise.all([
    reporter.waitForEvent('download'),
    reporter.getByRole('link', { name: 'Download approved GeoJSON' }).click()
  ]);
  const saved = path.join(outputDirectory, 'approved.geojson');
  await download.saveAs(saved);
  const exportedText = await readFile(saved, 'utf8');
  const exported = JSON.parse(exportedText);
  expect(exported.type).toBe('FeatureCollection');
  expect(exported.features).toHaveLength(2);
  const digest = createHash('sha256').update(exportedText).digest('hex');
  await expect(staff.getByText(digest, { exact: true })).toBeVisible();
  const screenshot = screenshotPath || path.join(outputDirectory, 'data-quality-review.png');
  await reporter.screenshot({ path: screenshot, fullPage: true });

  // A fully accepted upload can be published without an exclusion decision.
  const cleanSource = JSON.parse(await readFile(path.join(projectRoot, 'backend', 'samples', 'parks-clean.geojson'), 'utf8'));
  cleanSource.features[0].properties.asset_id += `-${suffix}`;
  const cleanName = `Staff clean ${suffix}`;
  await staff.getByRole('button', { name: 'Upload GeoJSON', exact: true }).click();
  await staff.locator('input[type="file"]').setInputFiles({ name: `${cleanName}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(cleanSource)) });
  await expect(staff.getByLabel('Dataset name', { exact: true })).toHaveValue(cleanName);
  await staff.getByRole('button', { name: 'Upload and validate', exact: true }).click();
  await expect(staff.getByRole('heading', { name: cleanName, exact: true })).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Approve valid features' })).toBeEnabled({ timeout: 30000 });
  await expect(staff.getByRole('checkbox', { name: /I acknowledge/ })).toHaveCount(0);
  await staff.getByRole('button', { name: 'Approve valid features' }).click();
  const cleanExport = staff.getByRole('link', { name: 'Download approved GeoJSON' });
  await expect(cleanExport).toBeVisible();
  const cleanExportPath = await cleanExport.getAttribute('href');
  const staffExport = await staff.request.get(new URL(cleanExportPath, baseURL).href);
  expect(staffExport.status()).toBe(200);
  expect((await staffExport.json()).features).toHaveLength(4);
  const forbiddenExport = await reporter.request.get(new URL(cleanExportPath, baseURL).href);
  expect(forbiddenExport.status()).toBe(404);
  await reporter.reload();
  await expect(reporter.getByRole('heading', { name: 'Dataset library' })).toBeVisible();
  await expect(reporter.getByRole('button', { name: new RegExp(cleanName) })).toHaveCount(0);

  // No valid geometry means no publishable version, even for staff.
  const rejectedName = `Rejected only ${suffix}`;
  const rejectedSource = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: rejectedName }, geometry: { type: 'Point', coordinates: [-97, 100] } }] };
  await reporter.getByRole('button', { name: 'Upload GeoJSON', exact: true }).click();
  await reporter.locator('input[type="file"]').setInputFiles({ name: `${rejectedName}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(rejectedSource)) });
  await expect(reporter.getByLabel('Dataset name', { exact: true })).toHaveValue(rejectedName);
  await reporter.getByRole('button', { name: 'Upload and validate', exact: true }).click();
  await expect(reporter.getByRole('heading', { name: rejectedName, exact: true })).toBeVisible();
  await expect(reporter.locator('tbody tr')).toHaveCount(1, { timeout: 30000 });
  await expect(reporter.getByText(/Required attribute 'asset_id' is missing or blank/)).toBeVisible();
  await staff.reload();
  await staff.getByRole('button', { name: new RegExp(rejectedName) }).click();
  await expect(staff.getByRole('heading', { name: rejectedName, exact: true })).toBeVisible();
  await expect(staff.getByRole('checkbox', { name: /I acknowledge that 1 rejected features/ })).toBeVisible();
  await staff.getByRole('checkbox', { name: /I acknowledge that 1 rejected features/ }).check();
  await expect(staff.getByRole('button', { name: 'Approve valid features' })).toBeDisabled();
  await expect(staff.getByRole('link', { name: 'Download approved GeoJSON' })).toHaveCount(0);

  expect(errors).toEqual([]);
  const result = { success: true, dataset: name, exportedFeatures: exported.features.length, sha256: digest, liveApprovalReceived: true, cleanExport: true, rejectedCannotPublish: true, reporterIsolation: true, screenshot };
  console.log(JSON.stringify(result, null, 2));
  return result;
} catch (error) {
  console.error(JSON.stringify({ errors, failedRequests, reporterAlerts: await reporter.getByRole('alert').allTextContents(), reporterText: (await reporter.locator('body').innerText()).slice(0, 2000) }, null, 2));
  await reporter.screenshot({ path: path.join(outputDirectory, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runDataPortalWorkflow();
