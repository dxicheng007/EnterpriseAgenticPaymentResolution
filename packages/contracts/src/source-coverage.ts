import { z } from 'zod';
import {
  DiagnosticSchema, EventKindSchema, HashSchema, IdSchema, IdSetSchema, RawIdentitySchema, setOf, strict,
} from './common.js';
import { SourceSnapshotSchema } from './source.js';

const SourceAccountCoverageSchema = strict({
  sellerEntityId: IdSchema,
  sourceAccountId: IdSchema,
  sourceBuyerId: IdSchema,
  displayName: z.string().refine(name => name.trim().length > 0, 'Expected a source display name'),
  identityEvidenceRefs: IdSetSchema
    .refine(refs => refs.length > 0, 'Expected at least one identity citation')
    .transform(refs => refs.toSorted()),
  relatedEvidenceRefs: IdSetSchema.transform(refs => refs.toSorted()),
});

const SourceCoverageEventSchema = strict({
  id: IdSchema,
  kind: EventKindSchema,
  rawIdentity: RawIdentitySchema,
});

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export const SourceCoverageResponseSchema = strict({
  companyId: IdSchema,
  sourceRef: IdSchema,
  manifestHash: HashSchema,
  snapshot: SourceSnapshotSchema,
  derivation: z.literal('captured-source-rules-v1'),
  accounts: setOf(SourceAccountCoverageSchema, account => account.sellerEntityId + '/' + account.sourceAccountId),
  events: setOf(SourceCoverageEventSchema, event => event.id),
  diagnostics: z.array(DiagnosticSchema),
}).superRefine((coverage, ctx) => {
  const { snapshot, sourceRef, companyId, events, accounts } = coverage;
  if (snapshot.sourceRef !== sourceRef) {
    ctx.addIssue({ code: 'custom', path: ['snapshot', 'sourceRef'], message: 'Snapshot source must match coverage source' });
  }

  const snapshotEventIds = new Set(snapshot.eventIds);
  if (snapshotEventIds.size !== snapshot.eventIds.length) {
    ctx.addIssue({ code: 'custom', path: ['snapshot', 'eventIds'], message: 'Duplicate snapshot event ID' });
  }
  if (events.length !== snapshotEventIds.size || events.some(event => !snapshotEventIds.has(event.id))) {
    ctx.addIssue({ code: 'custom', path: ['events'], message: 'Coverage events must match the snapshot event set' });
  }
  if (events.some(event => event.rawIdentity.companyId !== companyId)) {
    ctx.addIssue({ code: 'custom', path: ['events'], message: 'Event company must match coverage company' });
  }

  const snapshotEvidenceIds = new Set(snapshot.evidenceIds);
  if (snapshotEvidenceIds.size !== snapshot.evidenceIds.length) {
    ctx.addIssue({ code: 'custom', path: ['snapshot', 'evidenceIds'], message: 'Duplicate snapshot evidence ID' });
  }
  if (accounts.some(account =>
    [...account.identityEvidenceRefs, ...account.relatedEvidenceRefs].some(id => !snapshotEvidenceIds.has(id)))) {
    ctx.addIssue({ code: 'custom', path: ['accounts'], message: 'Account citations must belong to the snapshot' });
  }
}).transform(coverage => ({
  ...coverage,
  accounts: coverage.accounts.toSorted((left, right) =>
    compareIds(left.sellerEntityId, right.sellerEntityId) || compareIds(left.sourceAccountId, right.sourceAccountId)),
  events: coverage.events.toSorted((left, right) => compareIds(left.id, right.id)),
}));

export type SourceAccountCoverage = z.infer<typeof SourceAccountCoverageSchema>;
export type SourceCoverageEvent = z.infer<typeof SourceCoverageEventSchema>;
export type SourceCoverageResponse = z.infer<typeof SourceCoverageResponseSchema>;
