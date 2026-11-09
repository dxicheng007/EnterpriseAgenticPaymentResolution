import {
  RawSourceEventSchema, bootstrapRequiredCases, hashCanonical, hashEvent,
  type BootstrapCaseId, type Hold, type MutationPlan, type RawSourceEvent, type TargetState,
} from '@eapr/contracts';
import { compareBootstrapKeys } from './bootstrap-fixtures.js';
import { buildBootstrapReference, type BootstrapReferenceInput } from './bootstrap-reference.js';

type ExpectedHold = Pick<Hold, 'code' | 'scope' | 'eventIds'>;
export type BootstrapCase = {
  id: BootstrapCaseId;
  events: RawSourceEvent[];
  target: TargetState;
  expectedPlan: MutationPlan | null;
  expectedHolds: ExpectedHold[];
};

export function buildBootstrapCases(
  context: BootstrapReferenceInput, selectedProfileHash: string, target: TargetState,
): BootstrapCase[] | undefined {
  const reference = buildBootstrapReference(context, selectedProfileHash, target);
  if (!reference) return;
  const { profile, withMetadata, replay, plan } = reference;
  const { manifest, events } = context;
  const routes = (event: RawSourceEvent) => {
    const { companyId, sellerEntityId, sourceAccountId } = event.rawIdentity;
    if (!sellerEntityId || !sourceAccountId || sourceAccountId === '*') return 'unscoped';
    if (companyId !== profile.scope.companyId || sellerEntityId !== profile.scope.sellerEntityId ||
      event.sourceRef !== profile.sourceRef) return 'IDENTITY_SCOPE';
    return profile.sourceAccountIds.includes(sourceAccountId) ? 'selected' : 'UNKNOWN_ACCOUNT';
  };
  if (events.some(event => routes(event) === 'unscoped' ||
    (routes(event) === 'selected' && event.semanticVersion !== profile.semanticVersion))) return;

  const routeHold = (event: RawSourceEvent): ExpectedHold => ({ code: routes(event), eventIds: [event.id] });
  const eventOrder = (a: RawSourceEvent, b: RawSourceEvent) =>
    compareBootstrapKeys(a.sourceRef, b.sourceRef) || compareBootstrapKeys(a.streamId, b.streamId) ||
    a.sequence - b.sequence || compareBootstrapKeys(a.id, b.id);
  const unrelated = events.filter(event => routes(event) !== 'selected').sort(eventOrder);
  const baselineHolds = unrelated.map(routeHold);
  const selected = events.find(event => routes(event) === 'selected' && event.kind !== 'semantic_change');
  const foreign = unrelated.find(event => routes(event) === 'UNKNOWN_ACCOUNT' && event.kind !== 'semantic_change' &&
    context.evidence.producer.identities.some(identity => identity.sourceAccountId === event.rawIdentity.sourceAccountId));
  const configuration = withMetadata.billingConfigurations[0];
  const sequence = Math.max(0, ...manifest.streams.map(stream => Number(stream.resumeAfter)), ...events.map(event => event.sequence));
  if (!selected || !foreign || !configuration || !Number.isSafeInteger(sequence) || sequence > Number.MAX_SAFE_INTEGER - 3) return;

  const prefix = 'bootstrap-probe:' + hashCanonical([manifest.hash, profile.hash]);
  if (events.some(event => event.id.startsWith(prefix) || event.recordId.startsWith(prefix)) ||
    profile.semanticVersion === prefix + ':unreviewed') return;
  const seal = (event: RawSourceEvent) => RawSourceEventSchema.parse({ ...event, contentHash: hashEvent(event) });
  const selectedBlocker = seal({
    ...selected, id: prefix + ':selected', sequence: sequence + 1, semanticVersion: prefix + ':unreviewed',
  });
  const foreignProbe = seal({ ...foreign, id: prefix + ':foreign', sequence: sequence + 2 });
  const company = manifest.companyId === 'company-a' ? 'a' : 'b';
  const resource = company + '-semantics';
  const schemaVersion = manifest.schemaVersions[resource];
  if (!schemaVersion) return;
  const sourceWide = seal({
    id: prefix + ':source-wide', recordId: prefix + ':semantic', recordVersion: 1, sequence: sequence + 3,
    sourceRef: profile.sourceRef, kind: 'semantic_change', streamId: resource, resource, schemaVersion,
    effectiveAt: selected.effectiveAt, observedAt: manifest.asOf, semanticVersion: prefix + ':unreviewed',
    rawIdentity: { companyId: manifest.companyId, sellerEntityId: profile.scope.sellerEntityId },
    payload: company === 'a'
      ? { id: prefix + ':semantic', version: 1, account: '*', effective_date: selected.effectiveAt.slice(0, 10), revision: prefix + ':unreviewed' }
      : { transaction_key: prefix + ':semantic', revision_no: 1, client_code: '*',
        posted_on: selected.effectiveAt.slice(0, 10), revision: prefix + ':unreviewed' },
    contentHash: selected.contentHash,
  });

  const fixedHold = (code: string): ExpectedHold => ({ code, scope: profile.scope, eventIds: [] });
  const noBaseline = fixedHold('BOOTSTRAP_BASELINE_REQUIRED');
  const conflict = fixedHold('BOOTSTRAP_METADATA_CONFLICT');
  const blocked = fixedHold('BOOTSTRAP_BASELINE_BLOCKED');
  const successful = (caseTarget: TargetState, caseEvents = events, expectedHolds = baselineHolds) =>
    ({ events: caseEvents, target: caseTarget, expectedPlan: plan, expectedHolds });
  const negative = (caseTarget: TargetState, caseEvents: RawSourceEvent[], expectedHolds: ExpectedHold[]) =>
    ({ events: caseEvents, target: caseTarget, expectedPlan: null, expectedHolds });
  const cases: Record<BootstrapCaseId, Omit<BootstrapCase, 'id'>> = {
    captured_baseline: successful(target),
    exact_metadata_reuse: successful(withMetadata),
    customer_conflict: negative({
      ...withMetadata, customers: withMetadata.customers.map(record => ({ ...record, displayName: record.displayName + ' (conflict)' })),
    }, events, [...baselineHolds, conflict]),
    account_conflict: negative({
      ...withMetadata, accounts: withMetadata.accounts.map(record => ({
        ...record, parentCustomerId: record.parentCustomerId === prefix ? prefix + ':other' : prefix,
      })),
    }, events, [...baselineHolds, conflict]),
    configuration_conflict: negative({
      ...withMetadata, billingConfigurations: withMetadata.billingConfigurations.map(record => record.id !== configuration.id ? record :
        { ...record, contractTerm: { ...record.contractTerm, anchorDay: record.contractTerm.anchorDay === 1 ? 2 : 1 } }),
    }, events, [...baselineHolds, conflict]),
    empty_events: negative({
      ...target, customers: [], accounts: [], billingConfigurations: [],
    }, [], [noBaseline]),
    financial_replay: negative(replay, events, [...baselineHolds, noBaseline]),
    selected_blocker: negative(target, [...events, selectedBlocker], [...baselineHolds, {
      code: 'SEMANTIC_VERSION', eventIds: [selectedBlocker.id], scope: profile.scope,
    }, blocked]),
    source_wide_blocker: negative(target, [...events, sourceWide], [{
      code: 'SEMANTIC_VERSION', eventIds: [...events, sourceWide]
        .filter(event => event.sourceRef === profile.sourceRef && event.rawIdentity.companyId === manifest.companyId)
        .sort(eventOrder).map(event => event.id),
    }, blocked]),
    unrelated_account_hold: successful(target, [...events, foreignProbe], [...baselineHolds, routeHold(foreignProbe)]),
  };
  return bootstrapRequiredCases.map(id => ({ id, ...cases[id] }));
}
