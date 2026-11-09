import {
  ConnectorSpecSchema, CustomerProfileSchema, IdSchema, IsoDateSchema, PreviewRequestSchema,
  hashProfile, type BootstrapManifest, type DemoCandidatesResponse, type Diagnostic, type EntityMapping,
  type EvidenceResponse, type Id, type MappingOp, type RawSourceEvent, type SourceSnapshot,
} from '@eapr/contracts';
import { parseMinorUnits } from '@eapr/compiler/operations';
import type { SourceDefinition } from '@eapr/sources';

export type DemoCapture = { companyId: Id; manifestId: Id; contractFileId: Id | null };
type Candidate = DemoCandidatesResponse['candidates'][number];
type CandidateResult = { candidate: Candidate } | { diagnostic: Diagnostic };
type Agreement = { contractId: Id; sellerEntityId: Id; buyerId: Id; sourceAccountId: Id; feeCents: number; effective: string; legalName: string };

const id = '([A-Za-z0-9][A-Za-z0-9._:-]{0,159})';
const date = '(\\d{4}-\\d{2}-\\d{2})';
const amount = '((?:0|[1-9]\\d*)\\.\\d{2})';
// PDF.js joins text items with spaces, including an empty item for a line break.
const agreementHeader = 'Fixed monthly agreement ' + id + ' +Seller ' + id +
  '; buyer ' + id + '; account ' + id + ' +Legal name ([A-Za-z0-9]+(?: [A-Za-z0-9]+)*) +Monthly fee USD ';
const agreementPatterns = {
  a: new RegExp('^' + agreementHeader + amount + ' +Effective ' + date + '; monthly invoice anchor day 1\\.$'),
  b: new RegExp('^' + agreementHeader + amount + ' effective ' + date + '\\. +Monthly invoice anchor day 1\\.$'),
};

function parseAgreement(company: 'a' | 'b', text: string): Agreement | undefined {
  const match = agreementPatterns[company].exec(text);
  if (!match || match[0] !== text) return;
  const [, contractId, sellerEntityId, buyerId, sourceAccountId, legalName, fee, effective] = match;
  const parsed = parseMinorUnits(fee);
  if (!parsed.ok || parsed.cents <= 0 || !IsoDateSchema.safeParse(effective).success) return;
  return { contractId, sellerEntityId, buyerId, sourceAccountId, feeCents: parsed.cents, effective, legalName };
}

const mappingFields = {
  a: { date: '/effective_date', due: '/due_date', amount: '/amount', fundingKind: '/funding_kind',
    funding: '/funding_id', invoice: '/invoice_id', reversedKind: '/reversed_kind', reversed: '/reversed_id' },
  b: { date: '/posted_on', due: '/due_on', amount: '/amount_minor', fundingKind: '/receipt_type',
    funding: '/receipt_key', invoice: '/bill_key', reversedKind: '/void_type', reversed: '/void_key' },
};

function mappings(company: 'a' | 'b', source: SourceDefinition, evidenceRef: Id): EntityMapping[] {
  const paths = mappingFields[company];
  const field = (path: string): MappingOp => ({ op: 'field', path });
  const fundingKind = (path: string): MappingOp => ({
    op: 'enum_lookup', path, values: { payment: 'payment', credit: 'credit' },
  });
  const common = {
    currency: { op: 'constant', value: 'USD', evidenceRef } as const,
    effectiveAt: { op: 'date_parse', path: paths.date, format: 'YYYY-MM-DD', timezone: 'UTC' } as const,
  };
  const amountCents: MappingOp = company === 'a'
    ? { op: 'decimal_to_minor', path: paths.amount, scale: 2 }
    : field(paths.amount);
  const money = { ...common, amountCents };
  return source.contracts.flatMap(({ resource, kind }): EntityMapping[] => {
    switch (kind) {
      case 'invoice': return [{ resource, kind, fields: { ...money, dueDate: field(paths.due) } }];
      case 'payment':
      case 'credit': return [{ resource, kind, fields: money }];
      case 'allocation': return [{ resource, kind, fields: {
        ...money, fundingKind: fundingKind(paths.fundingKind), fundingRecordId: field(paths.funding),
        invoiceRecordId: { op: 'existing_invoice_lookup', path: paths.invoice },
      } }];
      case 'reversal': return [{ resource, kind, fields: {
        ...common, reversedKind: fundingKind(paths.reversedKind), reversedRecordId: field(paths.reversed),
      } }];
      case 'semantic_change': return [];
    }
  });
}

export function buildDemoCandidate({ source, capture, manifest, snapshot, events, citation }: {
  source: SourceDefinition;
  capture: DemoCapture;
  manifest: BootstrapManifest;
  snapshot: SourceSnapshot;
  events: RawSourceEvent[];
  citation?: EvidenceResponse;
}): CandidateResult {
  const blocked = (message: string): CandidateResult => ({
    diagnostic: {
      code: 'DEMO_CANDIDATE_UNSUPPORTED', severity: 'blocker', message,
      sourceIds: citation ? [citation.evidence.id] : [source.sourceRef], fieldPaths: [],
    },
  });
  const company = source.companyId === 'company-a' ? 'a' : source.companyId === 'company-b' ? 'b' : undefined;
  const member = manifest.files.find(file => file.fileId === capture.contractFileId && file.kind === 'contract_pdf');
  if (!company || !member || !citation || citation.evidence.sourceId !== member.fileId ||
    citation.evidence.sha256 !== member.sha256 || citation.evidence.snapshotId !== snapshot.id ||
    citation.evidence.locator.kind !== 'pdf' || citation.evidence.locator.page !== 1 ||
    citation.text.startInclusive !== 0 || citation.text.endExclusive !== citation.text.value.length ||
    !snapshot.evidenceIds.includes(citation.evidence.id)) {
    return blocked('The designated agreement has no applicable captured page-one citation');
  }
  const agreement = parseAgreement(company, citation.text.value);
  if (!agreement || agreement.sellerEntityId !== source.sellerEntityId ||
    agreement.effective > manifest.asOf.slice(0, 10)) {
    return blocked('The designated agreement has unsupported or conflicting terms');
  }
  const { sellerEntityId, buyerId, sourceAccountId, contractId, feeCents, effective, legalName } = agreement;
  const semanticKey = sellerEntityId + '/' + sourceAccountId;
  const semanticVersion = Object.hasOwn(manifest.semanticVersions, semanticKey) && manifest.semanticVersions[semanticKey];
  const accountEvents = events.filter(event => event.rawIdentity.sourceAccountId === sourceAccountId);
  if (!semanticVersion || Object.hasOwn(manifest.semanticVersions, '*') || !accountEvents.some(event => event.kind !== 'semantic_change') ||
    accountEvents.some(event => event.sourceRef !== source.sourceRef || event.rawIdentity.companyId !== source.companyId ||
      event.rawIdentity.sellerEntityId !== sellerEntityId || event.semanticVersion !== semanticVersion)) {
    return blocked('The agreement does not match the captured account and semantic revision');
  }
  const accountId = IdSchema.safeParse([source.companyId, sellerEntityId, sourceAccountId].join('.'));
  if (!accountId.success) return blocked('The agreement account identifier is unsupported');

  const evidenceRef = citation.evidence.id;
  const scope = { companyId: source.companyId, sellerEntityId, accountId: accountId.data };
  const termId = 'demo-term-' + company;
  const profile = {
    id: 'demo-profile-' + company, version: 2, sourceRef: source.sourceRef, scope, parentCustomerId: buyerId,
    sourceAccountIds: [sourceAccountId], semanticVersion,
    approvedLookups: [{ id: 'account-map', valueType: 'parent-account' as const, entries: [
      { source: sourceAccountId, target: scope.accountId, evidenceRefs: [evidenceRef] },
    ] }],
    contractTerms: [{
      id: termId, contractId, validFrom: effective, validToExclusive: null,
      fixedMonthlyFeeCents: feeCents, currency: 'USD' as const, cadence: 'monthly' as const, anchorDay: 1,
      evidenceRefs: [evidenceRef],
    }],
    findings: [],
    bootstrap: {
      customer: { id: buyerId, displayName: legalName, evidenceRefs: [evidenceRef] },
      billingConfigurationIds: [{ termId, id: 'configuration:' + termId }],
    },
  };
  const entities = mappings(company, source, evidenceRef);
  const spec = ConnectorSpecSchema.parse({
    id: 'demo-connector-' + company, version: 1, sourceRef: source.sourceRef, targetSchemaVersion: '1',
    sourceContracts: source.contracts, capture: source.streams, mappings: entities,
    allowedKinds: entities.map(entity => entity.kind), requiredValidators: [], runtimeModelCalls: 'forbidden',
    maxTransactionCents: 5000000, maxRecordsPerCycle: 1000, evidenceRefs: [evidenceRef],
  });
  const candidate = {
    id: 'demo-candidate-' + company, label: 'Company ' + company.toUpperCase() + ' · ' + legalName,
    companyId: source.companyId, sourceRef: source.sourceRef, scope, snapshotId: snapshot.id,
    request: PreviewRequestSchema.parse({
      spec, profiles: [CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) })],
      snapshotId: snapshot.id, asOf: manifest.asOf,
    }),
  };
  return { candidate };
}
