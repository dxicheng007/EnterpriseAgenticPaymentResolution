import { expect, test } from 'vitest';
import { hashCanonical, type BootstrapManifest, type SourceSnapshot } from '../../contracts/src/index.js';
import { CompileConnectorInputSchema, discoveryCompileToolSchemas } from '../../contracts/src/discovery-construction-tools.js';
import {
  assessmentClear, assertConstructionCapture, buildBlockedCompileResult, buildCompiledResult,
  sourcePayloadFor, type ConstructionCapture,
} from '../src/compilation.js';
import { toolSchemas } from '../src/roles.js';
import type { CaptureFacts } from '../src/tasks.js';

const binding = {
  companyId: 'company', sourceRef: 'source', manifestId: 'manifest', manifestHash: 'm'.repeat(64),
  snapshotId: 'snapshot', snapshotHash: 's'.repeat(64),
};

function capture(overrides: Partial<ConstructionCapture> = {}): ConstructionCapture {
  const facts: CaptureFacts = {
    binding, sourceAccounts: [{ kind: 'source_account', sellerEntityId: 'seller', sourceAccountId: 'account' }],
    evidenceIds: ['ev-a', 'ev-b'],
  };
  const manifest = {
    id: binding.manifestId, companyId: binding.companyId, sourceRef: binding.sourceRef,
    epoch: 1, hash: binding.manifestHash, streams: [], files: [],
  } as unknown as BootstrapManifest;
  const snapshot = {
    id: binding.snapshotId, manifestId: binding.manifestId, sourceRef: binding.sourceRef,
    contentHash: binding.snapshotHash, evidenceIds: ['ev-a', 'ev-b'], eventIds: [],
  } as unknown as SourceSnapshot;
  return { facts, manifest, snapshot, ...overrides };
}

test('compile schemas reject forged publication fields', () => {
  expect(CompileConnectorInputSchema.parse({ proposalId: 'proposal', revision: 1 }))
    .toEqual({ proposalId: 'proposal', revision: 1 });
  expect(CompileConnectorInputSchema.safeParse({ proposalId: 'proposal', revision: 1, artifactHash: 'a'.repeat(64) })
    .success).toBe(false);
  expect(discoveryCompileToolSchemas[0]).toMatchObject({ name: 'compileConnector' });
});

test('assertConstructionCapture requires exact binding equality', () => {
  expect(() => assertConstructionCapture(capture())).not.toThrow();
  expect(() => assertConstructionCapture(capture({
    snapshot: { ...capture().snapshot, contentHash: 'x'.repeat(64) },
  }))).toThrow(/DISCOVERY_CONFLICT/);
  expect(() => assertConstructionCapture(capture({
    facts: { ...capture().facts, evidenceIds: ['ev-a'] },
  }))).toThrow(/DISCOVERY_CONFLICT/);
});

test('compiled results require a clear assessment and blocked results never invent hashes', () => {
  const current = {
    proposalId: 'proposal', revision: 1, state: 'draft' as const, profileHashes: ['a'.repeat(64)],
    diagnostics: [], assessment: {
      revision: 1, observedRunRevision: 4, investigationIds: ['source'], diagnosticCodes: [] as string[],
      blockerRefs: [] as { findingId: string; revision: number; code: string }[],
    },
  };
  expect(assessmentClear(current)).toBe(true);
  expect(buildCompiledResult(current, 'a'.repeat(64))).toMatchObject({
    state: 'compiled', artifactHash: 'a'.repeat(64),
  });
  const blocked = buildBlockedCompileResult({
    ...current, assessment: { ...current.assessment, diagnosticCodes: ['FINDING_RESOLUTION_PENDING'] },
  }, [{ code: 'EVIDENCE_SUPPORT', severity: 'blocker', message: 'blocked', sourceIds: [], fieldPaths: [] }]);
  expect(blocked.state).toBe('compile_blocked');
  expect(blocked).not.toHaveProperty('artifactHash');
  expect(blocked.assessment.diagnosticCodes.sort()).toEqual(['EVIDENCE_SUPPORT', 'FINDING_RESOLUTION_PENDING']);
  expect(() => buildCompiledResult({
    ...current, assessment: { ...current.assessment, diagnosticCodes: ['FINDING_RESOLUTION_PENDING'] },
  }, 'a'.repeat(64))).toThrow(/DISCOVERY_CONFLICT/);
});

test('source payloads freeze the exact subject binding', () => {
  const subject = {
    proposalId: 'proposal', proposalRevision: 2, assessmentRevision: 3, observedRunRevision: 9,
    payload: { profiles: [{ hash: 'p'.repeat(64) }] } as never, payloadHash: 'h'.repeat(64),
    current: {} as never,
  };
  const payload = sourcePayloadFor(subject, binding, ['ev-b', 'ev-a']);
  expect(payload).toEqual({
    proposalId: 'proposal', proposalRevision: 2, assessmentRevision: 3, observedRunRevision: 9,
    proposalPayloadHash: 'h'.repeat(64), profileHashes: ['p'.repeat(64)], binding,
    captureEvidenceIds: ['ev-b', 'ev-a'],
  });
  expect(hashCanonical(payload.binding)).toBe(hashCanonical(binding));
});

test('compile descriptors advertise only when compile dependencies are present', () => {
  const names = (role: Parameters<typeof toolSchemas>[0], reads: boolean, compile = false) =>
    toolSchemas(role, reads, compile).map(tool => tool.name).filter(name => name.endsWith('Connector'));
  expect(names('connector', true)).toEqual(['draftConnector', 'reviseConnector']);
  expect(names('connector', true, true)).toEqual(['draftConnector', 'reviseConnector', 'compileConnector']);
  expect(names('connector', false, true)).toEqual([]);
  for (const role of ['coordinator', 'identity', 'contract', 'receivables'] as const) {
    expect(names(role, true, true)).toEqual([]);
  }
});
