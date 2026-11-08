import {
  ConnectorSpecSchema, CustomerProfileSchema, canonicalJson, hashProfile,
  type CompiledArtifact, type ConnectorSpec, type CustomerProfile, type Diagnostic, type EntityMapping,
  type Finding, type MappingOp, type NormalizedPlan, type Result, type Scope, type SourceContract,
} from '@eapr/contracts';
import { sameScope } from '@eapr/finance/validate';
import { canonicalArtifact, compare, ordered } from './canonicalize.js';
import { fieldName, isTargetValue, normalizeText } from './operations.js';

export function blocker(code: string, message: string, sourceIds: string[] = [], fieldPaths: string[] = []): Diagnostic {
  return { code, severity: 'blocker', message, sourceIds, fieldPaths };
}

function activeFindings(profile: CustomerProfile): Finding[] {
  const findings = new Map(profile.findings.map(finding => [finding.id, finding]));
  const superseded = new Set<string>();
  for (const finding of profile.findings) {
    const prior = finding.supersedesId ? findings.get(finding.supersedesId) : undefined;
    if (prior && sameScope(prior.scope, finding.scope) && prior.fieldPath === finding.fieldPath && prior.revision < finding.revision) {
      superseded.add(prior.id);
    }
  }
  return profile.findings.filter(finding => !superseded.has(finding.id));
}

function isSupported(finding: Finding, scope: Scope) {
  return sameScope(finding.scope, scope) && finding.evidenceStatus === 'supported' &&
    finding.reviewDisposition === 'confirmed' && finding.evidenceRefs.length > 0 &&
    (finding.provenanceClass === 'observed' || finding.provenanceClass === 'derived');
}

export function profileDiagnostics(profiles: CustomerProfile[], sourceRef: string): Diagnostic[] {
  if (!profiles.length) return [blocker('PROFILE_REQUIRED', 'At least one profile is required')];
  const diagnostics: Diagnostic[] = [];
  const hashes = new Set<string>();
  const profileIds = new Set<string>();
  const accountIds = new Set<string>();
  const sourceAccounts = new Set<string>();
  const material = /(?:^|\/)(?:amountCents|fixedMonthlyFeeCents|currency|fundingRecordId|invoiceRecordId|reversedRecordId|contractTerms|contractTerm|cadence|anchorDay|validFrom|validToExclusive)(?:\/|$)/;

  for (const profile of ordered(profiles, candidate => candidate.id)) {
    if (profile.sourceRef !== sourceRef || hashProfile(profile) !== profile.hash ||
      hashes.has(profile.hash) || profileIds.has(profile.id) || accountIds.has(profile.scope.accountId)) {
      diagnostics.push(blocker('PROFILE_CONFLICT', 'Profile source, hash or account scope conflicts', [profile.id]));
    }
    hashes.add(profile.hash);
    profileIds.add(profile.id);
    accountIds.add(profile.scope.accountId);
    if (!profile.sourceAccountIds.length) {
      diagnostics.push(blocker('IDENTITY_SCOPE', 'Profile has no reviewed source account', [profile.id]));
    }
    for (const account of profile.sourceAccountIds) {
      const key = profile.scope.companyId + '/' + profile.scope.sellerEntityId + '/' + account;
      if (sourceAccounts.has(key)) {
        diagnostics.push(blocker('IDENTITY_SCOPE', 'Source account maps to multiple profiles', [profile.id]));
      }
      sourceAccounts.add(key);
    }

    const terms = [...profile.contractTerms].sort((a, b) =>
      compare(a.contractId, b.contractId) || compare(a.validFrom, b.validFrom) || compare(a.id, b.id),
    );
    for (const [index, term] of terms.entries()) {
      const prior = terms[index - 1];
      if (prior?.contractId === term.contractId && (prior.validToExclusive === null || prior.validToExclusive > term.validFrom)) {
        diagnostics.push(blocker('TERM_OVERLAP', 'Contract has overlapping effective terms', [profile.id, prior.id, term.id]));
      }
      if (!term.evidenceRefs.length) {
        diagnostics.push(blocker('EVIDENCE_SUPPORT', 'Contract term has no supporting citation', [profile.id, term.id]));
      }
    }
    for (const finding of ordered(activeFindings(profile), candidate => candidate.id)) {
      if (material.test(finding.fieldPath) && !isSupported(finding, profile.scope)) {
        diagnostics.push(blocker('EVIDENCE_SUPPORT', 'Material finding lacks confirmed evidence', [profile.id, finding.id], [finding.fieldPath]));
      }
    }
  }
  return diagnostics;
}

function supportsConstant(
  op: Extract<MappingOp, { op: 'constant' }>, target: string, profiles: CustomerProfile[],
) {
  return profiles.every(profile => activeFindings(profile).some(finding =>
    isSupported(finding, profile.scope) && finding.fieldPath === '/' + target &&
    finding.evidenceRefs.includes(op.evidenceRef) && finding.value === op.value,
  ));
}

function mappingIssue(
  op: MappingOp, target: string, contract: SourceContract, profiles: CustomerProfile[], evidenceRefs?: string[],
): string | undefined {
  if (op.op === 'constant') {
    if (!isTargetValue(target, op.value)) return 'MAPPING_TYPE';
    if (evidenceRefs && !evidenceRefs.includes(op.evidenceRef)) return 'EVIDENCE_SUPPORT';
    if (target === 'currency' && op.value === contract.currency) return;
    // A v1 finding has no executable record binding for a resource-wide fixed amount.
    if (target === 'amountCents') return 'EVIDENCE_SUPPORT';
    return supportsConstant(op, target, profiles) ? undefined : 'EVIDENCE_SUPPORT';
  }
  if (op.op === 'effective_term') return 'MAPPING_TYPE';
  const field = fieldName(op.path);
  const source = Object.hasOwn(contract.fields, field) ? contract.fields[field] : undefined;
  if (!source) return 'MAPPING_SOURCE_FIELD';
  if (op.op === 'decimal_to_minor') {
    return target === 'amountCents' && source.type === 'string' && source.format === 'decimal2' ? undefined : 'MAPPING_TYPE';
  }
  if (op.op === 'field' && target === 'amountCents') {
    return source.type === 'integer' && source.unit === 'minor' ? undefined : 'MAPPING_TYPE';
  }
  if (source.type !== 'string') return 'MAPPING_TYPE';

  switch (op.op) {
    case 'field':
      if (target === 'dueDate') return source.format === 'iso-date' ? undefined : 'MAPPING_TYPE';
      if (target === 'effectiveAt') return source.format === 'iso-instant' ? undefined : 'MAPPING_TYPE';
      if (target.endsWith('RecordId')) return source.format === 'text' ? undefined : 'MAPPING_TYPE';
      return source.enum?.length && source.enum.every(value => isTargetValue(target, value)) ? undefined : 'MAPPING_TYPE';
    case 'date_parse':
      if (target !== 'effectiveAt') return 'MAPPING_TYPE';
      return source.format === (op.format === 'YYYY-MM-DD' ? 'iso-date' : 'iso-instant') ? undefined : 'MAPPING_TYPE';
    case 'enum_lookup': {
      const values = Object.values(op.values);
      return values.length && values.every(value => isTargetValue(target, value)) ? undefined : 'MAPPING_TYPE';
    }
    case 'approved_lookup':
      for (const profile of profiles) {
        const table = profile.approvedLookups.find(candidate => candidate.id === op.tableId);
        if (!table || table.valueType !== 'text' || !table.entries.length) return 'LOOKUP_MISSING';
        if (!table.entries.every(entry => entry.evidenceRefs.length)) return 'EVIDENCE_SUPPORT';
        if (!table.entries.every(entry => isTargetValue(target, entry.target))) return 'MAPPING_TYPE';
      }
      return;
    case 'existing_invoice_lookup':
      return target === 'invoiceRecordId' && source.format === 'text' ? undefined : 'MAPPING_TYPE';
    case 'normalize_text':
      if (target.endsWith('RecordId')) return 'MAPPING_TYPE';
      return source.enum?.length && source.enum.every(value => isTargetValue(target, normalizeText(value, op.mode)))
        ? undefined : 'MAPPING_TYPE';
  }
}

function metadataFieldsValid(contract: SourceContract) {
  const get = (key: string) => Object.hasOwn(contract.fields, key) ? contract.fields[key] : undefined;
  const recordId = get(contract.recordIdField);
  const recordVersion = get(contract.recordVersionField);
  const account = contract.accountIdField === null ? null : get(contract.accountIdField);
  return recordId?.type === 'string' && recordId.required && !recordId.nullable &&
    recordVersion?.type === 'integer' && recordVersion.required && !recordVersion.nullable && recordVersion.unit === 'count' &&
    (account === null || account?.type === 'string');
}

type ExecutableSpec = Pick<NormalizedPlan, 'sourceContracts' | 'capture' | 'mappings' | 'allowedKinds'>;

export function executableDiagnostics(
  spec: ExecutableSpec, profiles: CustomerProfile[], evidenceRefs?: string[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const contracts = new Map(spec.sourceContracts.map(contract => [contract.resource, contract]));
  const captures = new Map<string, number>();
  const mappings = new Map<string, EntityMapping>(spec.mappings.map(mapping => [mapping.resource, mapping]));
  for (const stream of ordered(spec.capture, candidate => candidate.streamId)) {
    for (const resource of [...stream.resources].sort()) {
      if (!contracts.has(resource)) {
        diagnostics.push(blocker('CAPTURE_CONTRACT', 'Capture resource has no source contract', [stream.streamId, resource]));
      }
      captures.set(resource, (captures.get(resource) ?? 0) + 1);
    }
  }
  for (const contract of ordered(spec.sourceContracts, candidate => candidate.resource)) {
    if (!metadataFieldsValid(contract)) {
      diagnostics.push(blocker('SOURCE_CONTRACT', 'Source contract identity fields are invalid', [contract.resource]));
    }
    if (captures.get(contract.resource) !== 1) {
      diagnostics.push(blocker('CAPTURE_CONTRACT', 'Source resource must belong to exactly one capture stream', [contract.resource]));
    }
    if (contract.kind !== 'semantic_change' && (!mappings.has(contract.resource) || !spec.allowedKinds.includes(contract.kind))) {
      diagnostics.push(blocker('MAPPING_REQUIRED', 'Financial resource has no permitted mapping', [contract.resource]));
    }
  }
  for (const mapping of ordered(spec.mappings, candidate => candidate.resource)) {
    const contract = contracts.get(mapping.resource);
    if (!contract || contract.kind !== mapping.kind) {
      diagnostics.push(blocker('MAPPING_CONTRACT', 'Mapping kind does not match its source contract', [mapping.resource]));
      continue;
    }
    for (const [target, op] of Object.entries(mapping.fields).sort(([a], [b]) => compare(a, b))) {
      const code = mappingIssue(op, target, contract, profiles, evidenceRefs);
      if (code) diagnostics.push(blocker(code, 'Mapping is unsupported for its source and target fields', [mapping.resource], ['/' + target]));
    }
  }
  return diagnostics;
}

export function compile(spec: ConnectorSpec, profiles: CustomerProfile[]): Result<CompiledArtifact> {
  try {
    // Apply the frozen JSON representation checks before traversing the structured input.
    canonicalJson(spec);
    canonicalJson(profiles);
    const specInput = ConnectorSpecSchema.safeParse(spec);
    const profileInput = CustomerProfileSchema.array().safeParse(profiles);
    if (!specInput.success || !profileInput.success) {
      return { ok: false, diagnostics: [blocker('COMPILER_INPUT', 'Invalid compiler input shape')] };
    }
    const diagnostics = [
      ...profileDiagnostics(profileInput.data, specInput.data.sourceRef),
      ...executableDiagnostics(specInput.data, profileInput.data, specInput.data.evidenceRefs),
    ];
    if (diagnostics.length) return { ok: false, diagnostics };
    return { ok: true, value: canonicalArtifact(specInput.data, profileInput.data) };
  } catch {
    return { ok: false, diagnostics: [blocker('COMPILER_INPUT', 'Compiler inputs are not canonical JSON')] };
  }
}
