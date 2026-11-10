import { expect, test } from 'vitest';
import { toolSchemas } from '../src/roles.js';
import {
  mapVerificationFailure, requireTrustedScope, trustedAccountIds,
} from '../src/verification-tools.js';
import type { RunRow, TaskRow } from '../src/repository.js';

const grants = (accounts: string[]) => ({
  allowedAccountIds: accounts,
  sourceRead: { companyId: 'company', sourceRef: 'source', sourceWide: true, accounts: [] },
});

test('verification descriptors advertise only when verification dependencies are present', () => {
  const names = (role: Parameters<typeof toolSchemas>[0], reads: boolean, verification = false) =>
    toolSchemas(role, reads, false, false, verification).map(tool => tool.name)
      .filter(name => name === 'requestVerification' || name === 'readVerification');
  expect(names('connector', true)).toEqual([]);
  expect(names('connector', true, true)).toEqual(['requestVerification', 'readVerification']);
  expect(names('connector', false, true)).toEqual([]);
  for (const role of ['coordinator', 'identity', 'contract', 'receivables'] as const) {
    expect(names(role, true, true)).toEqual([]);
  }
});

test('interim trusted scope requires account in both run and task grants', () => {
  const run = { grants: grants(['trusted-a', 'trusted-b']) } as unknown as RunRow;
  const task = { grants: grants(['trusted-a', 'proposed']) } as unknown as TaskRow;
  expect(trustedAccountIds(run, task)).toEqual(['trusted-a']);
  expect(requireTrustedScope(run, task, 'trusted-a')).toBeUndefined();
  expect(requireTrustedScope(run, task, 'proposed')).toBe('VERIFICATION_SCOPE_REQUIRED');
  expect(requireTrustedScope(run, task, 'trusted-b')).toBe('VERIFICATION_SCOPE_REQUIRED');
});

test('verification failures map owner-loss and attestation gaps to unavailable', () => {
  expect(mapVerificationFailure({ code: 'VERIFICATION_SCOPE_REQUIRED' })).toBe('VERIFICATION_SCOPE_REQUIRED');
  expect(mapVerificationFailure({ code: 'DISCOVERY_PAUSED' })).toBe('DISCOVERY_PAUSED');
  expect(mapVerificationFailure({ code: 'DISCOVERY_OWNER_LOST' })).toBe('TOOL_UNAVAILABLE');
  expect(mapVerificationFailure({ code: 'FINANCIAL_ATTESTATION_UNAVAILABLE' })).toBe('TOOL_UNAVAILABLE');
  expect(mapVerificationFailure(new Error('boom'))).toBe('TOOL_UNAVAILABLE');
});

test('verification interrupted diagnostic stays a non-blocker warning', async () => {
  const { verificationInterrupted, verificationInterruptedResult } = await import('../src/verification-tools.js');
  expect(verificationInterrupted).toMatchObject({
    code: 'VERIFICATION_INTERRUPTED', severity: 'warning',
  });
  expect(verificationInterruptedResult({
    jobId: '7117ef37-c37e-4902-9192-8787445ce8e3',
    state: 'running',
    diagnostics: [],
  })).toMatchObject({
    ok: true,
    job: {
      state: 'running',
      diagnostics: [expect.objectContaining({ code: 'VERIFICATION_INTERRUPTED', severity: 'warning' })],
    },
  });
});
