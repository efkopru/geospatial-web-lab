import { test, expect } from '@playwright/test';
import { runDataPortalWorkflow } from '../../02-data-quality-portal/frontend/tests/e2e.mjs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

test('data portal uploads, validates, reviews, publishes, streams updates and isolates users', async () => {
  test.setTimeout(150000);
  await mkdir('.runtime', { recursive: true });
  const result = await runDataPortalWorkflow({ screenshotPath: path.resolve('.runtime/portal.png') });
  expect(result.success).toBe(true);
});
