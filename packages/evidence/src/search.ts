import type { EvidenceRef, Id, RawIdentity } from '@eapr/contracts';

export type EvidenceCapability = {
  companyId: Id;
  sourceRef: Id;
  sourceWide: boolean;
  accounts: readonly {sellerEntityId:Id; sourceAccountId:Id}[];
};
export type EvidenceCoverage = {
  companyId: Id;
  sourceRef: Id;
  identities: readonly RawIdentity[];
};
export type SearchableCitation = {
  evidence: EvidenceRef;
  excerptCoverage: EvidenceCoverage;
};

export function permitsEvidence(capability: EvidenceCapability, coverage: EvidenceCoverage): boolean {
  if (capability.companyId !== coverage.companyId || capability.sourceRef !== coverage.sourceRef) return false;
  if (capability.sourceWide) return true;
  return coverage.identities.length > 0 && coverage.identities.every(identity =>
    identity.companyId === capability.companyId &&
    capability.accounts.some(account => account.sellerEntityId === identity.sellerEntityId &&
      account.sourceAccountId === identity.sourceAccountId));
}

export function searchEvidence(
  citations: Iterable<SearchableCitation>, capability: EvidenceCapability, query: string, limit: number,
): {id:Id; excerpt:string}[] {
  if (query.length < 1 || query.length > 256 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Invalid evidence search bounds');
  }
  const results: {id:Id; excerpt:string}[] = [];
  for (const {evidence, excerptCoverage} of citations) {
    if (!permitsEvidence(capability,excerptCoverage)) continue;
    const match = evidence.excerpt.indexOf(query);
    if (match < 0) continue;
    let start = Math.max(0,match - 500);
    if (start > 0 && /[\uDC00-\uDFFF]/.test(evidence.excerpt[start]!)) start--;
    let end = Math.min(evidence.excerpt.length,start + 2000);
    if (end < evidence.excerpt.length && /[\uDC00-\uDFFF]/.test(evidence.excerpt[end]!)) end--;
    results.push({id:evidence.id,excerpt:evidence.excerpt.slice(start,end)});
    if (results.length === limit) break;
  }
  return results;
}
