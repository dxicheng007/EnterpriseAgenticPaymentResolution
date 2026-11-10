import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'] } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], fileParallelism: false, testTimeout: 20_000, hookTimeout: 30_000 } },
    ],
  },
});
