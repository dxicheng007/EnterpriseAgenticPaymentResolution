import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { trace: 'on' },
  outputDir: process.env.EAPR_TRACE_DIR ?? 'test-results',
});
