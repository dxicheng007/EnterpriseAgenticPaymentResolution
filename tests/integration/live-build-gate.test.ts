import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const liveFile = 'tests/live/v4-build-connectors.test.ts';
const invalidFile = 'tests/integration/live-build-gate.test.ts';
const dummyKey = 'offline-dummy-not-a-credential';

test.each([
  { name: 'missing key', args: [liveFile], configured: false, diagnostic: 'LIVE_CONFIGURATION_UNAVAILABLE' },
  { name: 'dummy key', args: [liveFile], configured: true, diagnostic: 'LIVE_CONSTRUCTION_UNAVAILABLE' },
  { name: 'evidence and missing key', args: ['--evidence', liveFile], configured: false, diagnostic: 'LIVE_CONFIGURATION_UNAVAILABLE' },
  { name: 'evidence and dummy key', args: ['--evidence', liveFile], configured: true, diagnostic: 'LIVE_CONSTRUCTION_UNAVAILABLE' },
  { name: 'invalid file', args: [invalidFile], configured: true, diagnostic: 'Live tests must be files under tests/live/' },
  { name: 'evidence and invalid file', args: ['--evidence', invalidFile], configured: true, diagnostic: 'Live tests must be files under tests/live/' },
  { name: 'missing file', args: [], configured: false, diagnostic: 'Usage: npm run test:live' },
  { name: 'evidence without file', args: ['--evidence'], configured: true, diagnostic: 'Usage: npm run test:live' },
])('live command fails closed with $name', ({ args, configured, diagnostic }) => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  if (configured) env.OPENAI_API_KEY = dummyKey;

  const result = spawnSync('npm', ['run', 'test:live', '--', ...args], { env, encoding: 'utf8', timeout: 10_000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(diagnostic);
  expect(result.stdout + result.stderr).not.toContain(dummyKey);
});
