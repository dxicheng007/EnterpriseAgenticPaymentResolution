import { expect, test } from 'vitest';
import { hashCanonical, hashProfile } from '../../contracts/src/index.js';
import { DraftConnectorInputSchema } from '../../contracts/src/discovery-construction-tools.js';
import { profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { proposalPayload } from '../src/proposals.js';
import { toolSchemas } from '../src/roles.js';

test('namespace only representation identities while preserving all submitted customer content', () => {
  const { hash: _hash, ...profile } = profileA;
  const input = DraftConnectorInputSchema.parse({
    expectedRevision: 0, spec: validSpecA, profiles: [{ ...profile,
      bootstrap: { customer: { id: profile.parentCustomerId, displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity'] },
        billingConfigurationIds: [{ termId: profile.contractTerms[0]!.id, id: 'configuration-original' }] },
      findings: [{ id: 'unresolved-finding', taskId: 'other-task', scope: profile.scope, fieldPath: '/unknown',
        value: 123, origin: 'agent', provenanceClass: 'unresolved', evidenceStatus: 'insufficient',
        reviewDisposition: 'pending', evidenceRefs: [], derivationInputs: [], revision: 1 }],
    }], findingRefs: [],
  });
  const common = { runId: 'run', taskId: 'task', investigationIds: ['source', 'account'] };
  const first = proposalPayload({ ...common, proposalId: 'first', revision: 1 }, input);
  const second = proposalPayload({ ...common, proposalId: 'second', revision: 2 }, input);
  expect(first.spec).toEqual({ ...input.spec, id: 'discovery-spec:' + hashCanonical({
    runId: common.runId, submittedSpecId: input.spec.id,
  }) });
  expect(second.spec).toEqual(first.spec);
  for (const proposal of [first, second]) {
    const expected = { ...input.profiles[0]!,
      id: 'discovery-profile:' + hashCanonical({ runId: common.runId, proposalId: proposal.id }),
      version: proposal.revision };
    expect(proposal.profiles).toEqual([{ ...expected, hash: hashProfile(expected) }]);
  }
});

test('proposal descriptors require both source read access and the connector role', () => {
  const names = (role: Parameters<typeof toolSchemas>[0], reads: boolean, compile = false) =>
    toolSchemas(role, reads, compile).map(tool => tool.name).filter(name => name.endsWith('Connector'));
  expect(names('connector', true)).toEqual(['draftConnector', 'reviseConnector']);
  expect(names('connector', true, true)).toEqual(['draftConnector', 'reviseConnector', 'compileConnector']);
  expect(names('connector', false)).toEqual([]);
  for (const role of ['coordinator', 'identity', 'contract', 'receivables'] as const) {
    expect(names(role, true)).toEqual([]);
  }
});
