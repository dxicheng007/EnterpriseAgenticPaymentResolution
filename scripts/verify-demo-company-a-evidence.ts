import { z } from 'zod';
import { HashSchema, IdSchema, NonnegativeIntegerSchema, ScopeSchema, strict } from '../packages/contracts/src/common.js';
import { companyADemo as demo } from '../packages/contracts/src/demo-company-a.js';
import { type commandResult } from './verify-slice-evidence.js';
import { readV2Json } from './verify-v2-evidence.js';

export const companyAGate = 'demo-company-a-ai-off';
export const mountedCase = 'mounted Company A CLI applies with bounded worker HTTP isolation and recovers after process restart';

function testCommand(script: 'test:unit' | 'test:integration', file: string, names: readonly string[]) {
  return { script, file, names, command: 'npm run ' + script + ' -- ' + file + ' --reporter=json --outputFile=<private-report>' };
}

export const companyACommands = [
  testCommand('test:integration', 'tests/integration/demo-company-a-transport.test.ts', [
    'private HTTP applies the fixed source events once and recovers a lost worker response',
    'disabled and unapproved private commands cannot write parent state',
    'foreign source events remain in the real feed and block the fixed apply',
    'mounted worker source and dependency inventory stays within the inspected HTTP path',
    'actual worker child rejects a leaked model credential before service readiness',
    mountedCase,
  ]),
  testCommand('test:integration', 'tests/integration/demo-inject-cli.test.ts', [
    'demo CLI sends the fixed commands and safely reports the authoritative receipt',
    ...[
      'wrong scenario', 'extra input', 'missing bearer', 'source non-2xx', 'source malformed', 'worker non-2xx',
      'worker malformed', 'worker wrong scope', 'worker oversized', 'worker timeout', 'worker response lost',
    ].map(name => 'demo CLI fails safely for ' + name),
  ]),
  testCommand('test:unit', 'apps/control/test/demo-source-composition.test.ts', [
    'the source feed uses a distinct bearer and accepts only a canonical fixed-stream query',
  ]),
  testCommand('test:unit', 'apps/worker/test/demo-sync-composition.test.ts', [
    'the fixed worker command authenticates before parsing and rejects overrides',
  ]),
  testCommand('test:unit', 'apps/worker/test/demo-source-client.test.ts', [
    'the private source client bounds and validates real HTTP responses',
  ]),
  { script: 'typecheck', command: 'npm run typecheck', file: undefined, names: [] },
] as const;

const yes = z.literal(true);
const observationSchema = strict({
  schemaVersion: z.literal(1), gate: z.literal(companyAGate), test: z.literal(mountedCase), runToken: HashSchema,
  constructionMode: z.literal('development-fixture'), targetMode: z.literal('persisted-parent'), seed: z.literal(demo.seed),
  scope: ScopeSchema.refine(scope => scope.companyId === demo.scope.companyId &&
    scope.sellerEntityId === demo.scope.sellerEntityId && scope.accountId === demo.scope.accountId),
  parentCustomerId: z.literal(demo.parentCustomerId), sourceRef: z.literal(demo.sourceRef),
  manifestId: z.literal(demo.manifestId), manifestHash: HashSchema, artifactHash: HashSchema, profileHash: HashSchema,
  candidateId: z.literal(demo.candidateId), profileId: z.literal(demo.profileId), profileVersion: z.literal(demo.profileVersion),
  specId: z.literal(demo.connectorId), specVersion: z.literal(demo.connectorVersion),
  activation: strict({
    activationId: IdSchema, initialReceiptId: IdSchema, epoch: z.literal(1), initialAfterBalanceCents: z.literal(80000),
  }),
  sync: strict({
    receiptId: IdSchema, activationId: IdSchema, epoch: z.literal(1), artifactHash: HashSchema,
    replayed: z.literal(false), beforeBalanceCents: z.literal(80000), afterBalanceCents: z.literal(50000),
    replayReceiptId: IdSchema,
  }),
  sourceEventIds: z.tuple([z.literal(demo.eventIds[0]), z.literal(demo.eventIds[1])]),
  paymentId: z.literal(demo.recordIds[0]), allocationId: z.literal(demo.recordIds[1]),
  amountCents: z.literal(30000), effectiveDate: z.literal(demo.scenario.effectiveDate), observedAt: z.literal(demo.scenario.observedAt),
  parent: strict({
    currentAsOf: z.literal(demo.scenario.observedAt), currentBalanceCents: z.literal(50000),
    cutoverAsOf: z.literal(demo.cutover), cutoverBalanceCents: z.literal(80000),
    beforeVersion: NonnegativeIntegerSchema, afterVersion: NonnegativeIntegerSchema, approvedSnapshotHash: HashSchema,
  }),
  assertions: strict({
    baselineExcludesInjectedEvents: yes, sameApproval: yes, onePaymentAndAllocation: yes, approvedSnapshotUnchanged: yes,
    receiptMatchesStoredParent: yes, actualSupervisorMount: yes, privateBoundary: yes,
  }),
  runtimeIsolation: strict({
    credentialsAbsent: yes, modelFreeWorkerImports: yes, mountedHttpPathProtected: yes, positiveControlPassed: yes,
  }),
}).refine(({ activation, sync, artifactHash, parent }) =>
  activation.activationId === sync.activationId && activation.epoch === sync.epoch &&
  activation.initialReceiptId !== sync.receiptId && sync.receiptId === sync.replayReceiptId &&
  artifactHash === sync.artifactHash && parent.afterVersion === parent.beforeVersion + 1,
);

export function parseCompanyAObservation(value: unknown, token: string) {
  const parsed = observationSchema.safeParse(value);
  if (!parsed.success || parsed.data.runToken !== token) return;
  const { runToken: _runToken, ...observation } = parsed.data;
  return observation;
}

export function readCompanyAObservation(path: string, token: string) {
  try {
    return parseCompanyAObservation(readV2Json(path, 64 * 1024), token);
  } catch {
    return undefined;
  }
}

export function companyAGateOutcome(
  commands: readonly ReturnType<typeof commandResult>[],
  diagnostics: readonly string[],
  observation: ReturnType<typeof parseCompanyAObservation>,
) {
  const failures = [...diagnostics];
  if (commands.length !== companyACommands.length || !companyACommands.every((expected, index) => {
    const actual = commands[index];
    return actual.command === expected.command && actual.exitCode === 0 && actual.signal === null &&
      actual.result === 'passed' && actual.diagnostics.length === 0 && actual.cases.length === expected.names.length &&
      expected.names.every((name, i) => actual.cases[i].file === expected.file &&
        actual.cases[i].name === name && actual.cases[i].status === 'passed');
  })) failures.push('required-commands-incomplete-or-failed');
  if (!observation) failures.push('mounted-observation-unavailable-or-invalid');
  return {
    diagnostics: failures,
    result: failures.length ? 'failed' as const : 'passed' as const,
    fullV5: 'not-established' as const,
    exitCode: failures.length ? 1 : 0,
  };
}
