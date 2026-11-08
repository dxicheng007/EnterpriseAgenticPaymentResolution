import { z } from 'zod';
import {
  HashSchema, IdSchema, IsoDateSchema, IsoInstantSchema, SafeIntegerSchema, TargetStateSchema,
  TransactionCentsSchema, VersionSchema, hashCanonical, hashEvent, hashManifest, hashProfile, strict, targetRecordId,
  type BootstrapManifest, type CustomerProfile, type RawSourceEvent, type SourceSnapshot, type TargetState,
} from '@eapr/contracts';
import { evaluateReferenceState } from './reference-model.js';

const fundingKind = z.enum(['payment', 'credit']);
const base = {
  recordId: IdSchema, sourceEventId: IdSchema, sourceRecordVersion: VersionSchema,
  effectiveAt: IsoInstantSchema, currency: z.literal('USD'),
};
const monetary = { ...base, amountCents: TransactionCentsSchema };
const recordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...monetary, kind: z.literal('invoice'), dueDate: IsoDateSchema }),
  z.strictObject({ ...monetary, kind: z.literal('payment') }),
  z.strictObject({ ...monetary, kind: z.literal('credit') }),
  z.strictObject({ ...monetary, kind: z.literal('allocation'), fundingKind, fundingRecordId: IdSchema, invoiceRecordId: IdSchema }),
  z.strictObject({ ...base, kind: z.literal('reversal'), reversedKind: fundingKind, reversedRecordId: IdSchema }),
]);
const truthSchema = strict({
  schemaVersion: z.literal(1),
  fixtureSetId: IdSchema,
  fixtureSetVersion: IdSchema,
  purpose: z.enum(['construction', 'final_holdout']),
  generator: strict({ seed: IdSchema, buildHash: HashSchema }),
  companyId: IdSchema, sourceRef: IdSchema, sellerEntityId: IdSchema, asOf: IsoInstantSchema,
  manifestId: IdSchema, manifestHash: HashSchema,
  inputEvents: z.array(strict({ id: IdSchema, contentHash: HashSchema })),
  accounts: z.array(strict({
    sourceAccountId: IdSchema, records: z.array(recordSchema), balanceAnchorCents: SafeIntegerSchema.nullable(),
  })),
  evidence: z.array(strict({ fileId: IdSchema, originalSha256: HashSchema, text: z.string() })),
  hash: HashSchema,
});
export type ProtectedFixtureSet = z.infer<typeof truthSchema>;
type FixturePin = Pick<ProtectedFixtureSet, 'fixtureSetId' | 'fixtureSetVersion' | 'hash'>;

function invalid(): never {
  throw new Error('Protected fixture invalid');
}

function ordered<T>(items: readonly T[], key: (item: T) => string): T[] {
  const keys = items.map(key);
  if (new Set(keys).size !== keys.length) invalid();
  return [...items].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

export function decodeTruth(text: string, pin?: FixturePin): ProtectedFixtureSet {
  try {
    const { hash, ...truth } = truthSchema.parse(JSON.parse(text));
    const canonical = {
      ...truth, inputEvents: ordered(truth.inputEvents, event => event.id),
      accounts: ordered(truth.accounts, account => account.sourceAccountId).map(account => ({
        ...account, records: ordered(account.records, record => record.kind + ':' + record.recordId),
      })),
      evidence: ordered(truth.evidence, evidence => evidence.fileId),
    };
    const records = canonical.accounts.flatMap(account => account.records);
    ordered(records, record => record.kind + ':' + record.recordId);
    ordered(records, record => record.sourceEventId);
    if (hashCanonical(canonical) !== hash ||
      (pin && (pin.hash !== hash || pin.fixtureSetId !== truth.fixtureSetId || pin.fixtureSetVersion !== truth.fixtureSetVersion))) invalid();
    return { ...canonical, hash };
  } catch {
    return invalid();
  }
}

export function verifyTruthMembers(
  truth: ProtectedFixtureSet,
  manifest: BootstrapManifest,
  snapshot: Pick<SourceSnapshot, 'eventIds'>,
  events: readonly RawSourceEvent[],
): void {
  try {
    if (manifest.id !== truth.manifestId || manifest.hash !== truth.manifestHash || manifest.hash !== hashManifest(manifest) ||
      manifest.asOf !== truth.asOf || manifest.sourceRef !== truth.sourceRef || manifest.companyId !== truth.companyId) invalid();
    const actual = ordered(events, event => event.id);
    if (hashCanonical(actual.map(({ id, contentHash }) => ({ id, contentHash }))) !== hashCanonical(truth.inputEvents) ||
      hashCanonical(ordered(snapshot.eventIds, id => id)) !== hashCanonical(actual.map(event => event.id))) invalid();
    if (actual.some(event => event.contentHash !== hashEvent(event) || event.sourceRef !== truth.sourceRef ||
      event.rawIdentity.companyId !== truth.companyId || manifest.schemaVersions[event.resource] !== event.schemaVersion)) invalid();

    const byId = new Map(actual.map(event => [event.id, event]));
    const members = manifest.streams.flatMap(stream => {
      const streamEvents = stream.eventIds.map(id => byId.get(id));
      if (streamEvents.length !== Number(stream.resumeAfter)) invalid();
      const preimage = streamEvents.map((event, index) => {
        if (!event || event.streamId !== stream.streamId || event.sequence !== index + 1) invalid();
        return { id: event.id, contentHash: event.contentHash };
      });
      if (hashCanonical({ sourceRef: truth.sourceRef, streamId: stream.streamId,
        resumeAfter: stream.resumeAfter, events: preimage }) !== stream.snapshotHash) invalid();
      return stream.eventIds;
    });
    if (hashCanonical(ordered(members, id => id)) !== hashCanonical(actual.map(event => event.id))) invalid();

    const financialEvents = new Set(actual.filter(event => event.kind !== 'semantic_change').map(event => event.id));
    for (const account of truth.accounts) {
      for (const record of account.records) {
        const event = byId.get(record.sourceEventId);
        if (!event || !financialEvents.delete(event.id) ||
          event.rawIdentity.sellerEntityId !== truth.sellerEntityId || event.rawIdentity.sourceAccountId !== account.sourceAccountId ||
          event.kind !== record.kind || event.recordId !== record.recordId ||
          event.recordVersion !== record.sourceRecordVersion || event.effectiveAt !== record.effectiveAt) invalid();
      }
    }
    if (financialEvents.size || truth.evidence.some(evidence =>
      !manifest.files.some(file => file.fileId === evidence.fileId && file.sha256 === evidence.originalSha256))) invalid();
  } catch {
    invalid();
  }
}

export function bindTruth(truth: ProtectedFixtureSet, profiles: readonly CustomerProfile[]) {
  try {
    if (!truth.accounts.length || !profiles.length) invalid();
    ordered(profiles, profile => profile.hash);
    for (const profile of profiles) {
      if (profile.hash !== hashProfile(profile) || profile.sourceRef !== truth.sourceRef ||
        profile.scope.companyId !== truth.companyId || profile.scope.sellerEntityId !== truth.sellerEntityId ||
        !profile.sourceAccountIds.length ||
        profile.sourceAccountIds.some(id => !truth.accounts.some(account => account.sourceAccountId === id))) invalid();
    }
    for (const account of truth.accounts) {
      if (profiles.filter(profile => profile.sourceAccountIds.includes(account.sourceAccountId)).length > 1) invalid();
    }
    return profiles.map(profile => {
      const accounts = truth.accounts.filter(account => profile.sourceAccountIds.includes(account.sourceAccountId));
      const expected = (selected: typeof accounts): TargetState => {
        const records = selected.flatMap(account => account.records.map(({ recordId, ...record }) => {
          const identity = { sourceRef: truth.sourceRef, sellerEntityId: truth.sellerEntityId, kind: record.kind, recordId };
          return { ...record, id: targetRecordId(identity), identity, scope: profile.scope };
        }));
        return TargetStateSchema.parse({
          scope: profile.scope, asOf: truth.asOf, version: 0,
          invoices: records.filter(record => record.kind === 'invoice'),
          payments: records.filter(record => record.kind === 'payment'),
          credits: records.filter(record => record.kind === 'credit'),
          allocations: records.filter(record => record.kind === 'allocation'),
          reversals: records.filter(record => record.kind === 'reversal'),
          customers: [], accounts: [], billingConfigurations: [],
        });
      };
      for (const account of accounts) {
        if (account.balanceAnchorCents !== null &&
          evaluateReferenceState(expected([account])).balanceCents !== account.balanceAnchorCents) invalid();
      }
      const target = expected(accounts);
      return { profile, target, reference: evaluateReferenceState(target) };
    });
  } catch {
    return invalid();
  }
}
