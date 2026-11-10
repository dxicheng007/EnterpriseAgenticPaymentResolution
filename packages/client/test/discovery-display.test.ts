import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { DiscoveryConstruction } from '../../../apps/web/src/features/discovery/DiscoveryConstruction.js';
import { DiscoveryStateV2Schema, type DiscoveryStateV2 } from '../../contracts/src/discovery.js';

const artifactHash = 'a'.repeat(64);
const profileHash = 'b'.repeat(64);
function state(): DiscoveryStateV2 {
  return DiscoveryStateV2Schema.parse({
    schemaVersion: 2, id: 'run-details', revision: 12, status: 'blocked', modelId: 'scripted-test', mode: 'scripted',
    binding: { companyId: 'company-a', sourceRef: 'legacy-a', manifestId: 'manifest-a',
      snapshotId: 'snapshot-a', manifestHash: 'c'.repeat(64), snapshotHash: 'd'.repeat(64) },
    inFlightModelCalls: 0, inFlightToolSteps: 0, tasks: [],
    findings: [{ id: 'finding-terms', revision: 2, taskId: 'task-contract',
      subject: { kind: 'source_account', sellerEntityId: 'seller-a', sourceAccountId: 'customer-1' } }],
    proposals: [{
      proposalId: 'proposal-a', revision: 3, state: 'compile_blocked', artifactHash, profileHashes: [profileHash],
      diagnostics: [{ code: 'UNSUPPORTED_TERM', severity: 'blocker', message: '<unsupported term>',
        sourceIds: ['document-a'], fieldPaths: ['/contractTerms'] }],
      assessment: { revision: 4, observedRunRevision: 11, investigationIds: ['investigation-a'],
        blockerRefs: [{ findingId: 'finding-terms', revision: 1, code: 'FINDING_RESOLUTION_PENDING' }],
        diagnosticCodes: ['ASSESSMENT_BLOCKED'] },
    }],
    verificationJobs: [{ proposalId: 'proposal-a', proposalRevision: 2, jobId: 'job-old' }],
    usage: { modelCalls: 1, inputTokens: 10, outputTokens: 5, unknownUsageCalls: 0, cost: { status: 'unavailable' } },
    diagnostics: [],
  });
}

const render = (value: DiscoveryStateV2) =>
  renderToStaticMarkup(createElement(DiscoveryConstruction, { state: value }));

test('shows exact finding and blocker revisions without treating references as evidence or reviewer decisions', () => {
  const html = render(state());
  expect(html).toContain('finding-terms');
  expect(html).toContain('Revision 2');
  expect(html).toContain('task-contract');
  expect(html).toContain('seller-a / customer-1');
  expect(html).toContain('FINDING_RESOLUTION_PENDING');
  expect(html).toContain('finding-terms · revision 1');
  expect(html).toContain('Finding bodies, citations, and document associations are not exposed by this run read API.');
  expect(html).toContain('Agent interpretations are not independently verified facts or reviewer decisions.');
  expect(html).not.toContain('<button');
});

test('distinguishes blocked proposals and historical hashes from a compiled candidate', () => {
  const html = render(state());
  expect(html).toContain('proposal-a');
  expect(html).toContain('Proposal revision');
  expect(html).toContain('Compile blocked');
  expect(html).toContain('Assessment revision');
  expect(html).toContain('Observed run revision');
  expect(html).toContain('investigation-a');
  expect(html).toContain('ASSESSMENT_BLOCKED');
  expect(html).toContain('Historical hashes - not a current compiled candidate');
  expect(html).toContain(artifactHash);
  expect(html).toContain(profileHash);
  expect(html).toContain('&lt;unsupported term&gt;');
  expect(html).not.toContain('<unsupported term>');
  expect(html).toContain('document-a');
  expect(html).toContain('/contractTerms');
});

test('shows compiled hashes without claiming verification, eligibility, or approval', () => {
  const value = state();
  value.proposals[0] = {
    proposalId: 'proposal-a', revision: 3, state: 'compiled', artifactHash, profileHashes: [profileHash],
    diagnostics: [], assessment: { revision: 5, observedRunRevision: 12, investigationIds: ['investigation-a'],
      blockerRefs: [], diagnosticCodes: [] },
  };
  const html = render(value);
  expect(html).toContain('Compiled candidate hashes');
  expect(html).toContain('Compilation does not establish independent verification, review readiness, approval, or activation.');
  expect(html).not.toContain('Historical hashes');
  expect(html).not.toContain('Eligible for review');
});

test('keeps verification references bound to their proposal revision and does not invent report results', () => {
  const html = render(state());
  expect(html).toContain('job-old');
  expect(html).toContain('proposal-a · revision 2');
  expect(html).toContain('Job references are not verification results or evidence of eligibility.');
  expect(html).not.toContain('Passed');
  expect(html).not.toContain('Eligible for review');
});

test('reports absent saved results truthfully without inferring construction capability', () => {
  const value = state();
  value.findings = [];
  value.proposals = [];
  value.verificationJobs = [];
  const html = render(value);
  expect(html).toContain('No findings recorded.');
  expect(html).toContain('No proposals recorded.');
  expect(html).toContain('No verification jobs linked to this run.');
  expect(html).not.toContain('Connector construction is unavailable');
});
