import { expect, test } from 'vitest';
import { DemoCandidatesResponseSchema, LocalSessionResponseSchema } from '../src/local-demo.js';

test('the browser-safe demo wire contracts reject additional fields', () => {
  const session = {
    demoOnly: true, reviewer: { reviewerId: 'demo-reviewer', sessionId: 'session-test' },
    allowedSourceRefs: ['source-a'], allowedAccountIds: ['company-a.seller-a.account-a'], csrfToken: 'csrf',
  };
  expect(LocalSessionResponseSchema.parse(session)).toEqual(session);
  expect(LocalSessionResponseSchema.safeParse({ ...session, credential: 'private' }).success).toBe(false);
  expect(LocalSessionResponseSchema.safeParse({ ...session, reviewer: { ...session.reviewer, role: 'admin' } }).success).toBe(false);
  const catalog = { mode: 'development-fixture', targetMode: 'empty-fixture', verificationAvailable: false, candidates: [], diagnostics: [] };
  expect(DemoCandidatesResponseSchema.parse(catalog)).toEqual(catalog);
  expect(DemoCandidatesResponseSchema.safeParse({ ...catalog, targetMode: 'real' }).success).toBe(false);
  expect(DemoCandidatesResponseSchema.safeParse({ ...catalog, report: {} }).success).toBe(false);
});
