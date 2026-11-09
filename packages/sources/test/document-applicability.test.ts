import {
  hashBytes, hashCanonical, type DiscoveryBinding, type EvidenceRef, type Hash, type Id, type IsoInstant,
  type SourceReadGrant,
} from '@eapr/contracts';
import type { Extraction } from '@eapr/evidence';
import { expect, it } from 'vitest';
import { companyA } from '../src/company-a.js';
import { companyB } from '../src/company-b.js';
import {
  partitionDocumentApplicability, validateDocumentApplicabilityRequest,
  type DocumentApplicabilityCapture, type DocumentApplicabilityRequest, type DocumentAssociation,
} from '../src/document-applicability.js';
import { parseAgreement, parseDirectory } from '../src/document-identity.js';
import { documentCitations } from '../src/dossier.js';
import { citeEvidence } from '../src/evidence-records.js';
import type { SourceDefinition } from '../src/records.js';
import { sourceFileId, type StoredSourceFile } from '../src/uploads.js';

const asOf = '2026-10-01T00:00:00.000Z';
const id = (prefix: string): Id => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const digest = (value: string): Hash => hashBytes(Buffer.from(value));
const party = (seller: Id) => ({
  contract: id('contract'), seller, buyer: id('buyer'), account: id('acct'), name: 'Studio ' + id('nm'),
});

const agreementText = (options: {
  format: 'a' | 'b'; contract: string; seller: string; buyer: string; account: string; name: string;
  fee?: string; date?: string;
}): string => {
  const { fee = '1234.56', date = '2026-07-01' } = options;
  const header = 'Fixed monthly agreement ' + options.contract + '   Seller ' + options.seller +
    '; buyer ' + options.buyer + '; account ' + options.account +
    '  Legal name ' + options.name + '  Monthly fee USD ' + fee;
  return options.format === 'a'
    ? header + '  Effective ' + date + '; monthly invoice anchor day 1.'
    : header + ' effective ' + date + '.  Monthly invoice anchor day 1.';
};

const directoryText = (seller: string, pairs: string) =>
  'Seller ' + seller + ' reports separate customer accounts: ' + pairs + '. Currency USD.';

const amendmentText = (contract: string, seller: string, buyer: string) =>
  'Executed amendment to ' + contract + '  Seller ' + seller + ' and buyer ' + buyer +
  ' agree.  Effective 2026-09-01, replace monthly fee with USD 42.00.  Signed by both parties.';

function bind(source: SourceDefinition): DiscoveryBinding {
  const manifestId = id('manifest');
  return {
    companyId: source.companyId, sourceRef: source.sourceRef, manifestId, snapshotId: 'snapshot:' + manifestId,
    manifestHash: digest(manifestId), snapshotHash: digest('snap' + manifestId),
  };
}

function wideGrant(binding: DiscoveryBinding): SourceReadGrant {
  return { companyId: binding.companyId, sourceRef: binding.sourceRef, sourceWide: true, accounts: [] };
}

function accountGrant(binding: DiscoveryBinding, seller: Id, account: Id): SourceReadGrant {
  return {
    companyId: binding.companyId, sourceRef: binding.sourceRef, sourceWide: false,
    accounts: [{ sellerEntityId: seller, sourceAccountId: account }],
  };
}

function pdfFile(
  binding: DiscoveryBinding, kind: 'contract_pdf' | 'amendment_pdf', pages: string[],
  options: { documentId?: Id; contentHash?: Hash } = {},
): StoredSourceFile {
  const metadata = {
    companyId: binding.companyId, sourceRef: binding.sourceRef,
    documentId: options.documentId ?? id('doc'), documentVersion: 1, kind,
    originalName: kind === 'contract_pdf' ? 'agreement.pdf' : 'amendment.pdf',
  };
  const extraction: Extraction = { document: { kind: 'pdf', pages }, mediaType: 'application/pdf', extractor: 'test' };
  return {
    file_id: sourceFileId(metadata), content_hash: options.contentHash ?? digest(id('blob')),
    byte_length: 128, metadata, extraction, extraction_hash: hashCanonical(extraction),
  };
}

function emailFile(binding: DiscoveryBinding, body: string): StoredSourceFile {
  const metadata = {
    companyId: binding.companyId, sourceRef: binding.sourceRef,
    documentId: id('mail'), documentVersion: 1, kind: 'email_json' as const, originalName: 'note.json',
  };
  const extraction: Extraction = {
    document: { kind: 'email', messageId: id('msg'), body }, mediaType: 'application/json', extractor: 'test',
  };
  return {
    file_id: sourceFileId(metadata), content_hash: digest(id('blob')), byte_length: 64,
    metadata, extraction, extraction_hash: hashCanonical(extraction),
  };
}

function csvFile(binding: DiscoveryBinding): StoredSourceFile {
  const metadata = {
    companyId: binding.companyId, sourceRef: binding.sourceRef,
    documentId: id('csv'), documentVersion: 1, kind: 'event_csv' as const, originalName: 'events.csv',
    batch: { batchId: id('batch'), sequence: 1, streamId: id('stream') },
  };
  const extraction: Extraction = {
    document: { kind: 'csv', headers: ['payload_json'], rows: [['{}']] },
    mediaType: 'text/csv', extractor: 'test',
  };
  return {
    file_id: sourceFileId(metadata), content_hash: digest(id('blob')), byte_length: 32,
    metadata, extraction, extraction_hash: hashCanonical(extraction),
  };
}

function apiCitation(snapshotId: Id): EvidenceRef {
  const sourceId = 'api:' + id('api');
  const extraction: Extraction = {
    document: { kind: 'json', value: { record: id('payload') } }, mediaType: 'application/json', extractor: 'test',
  };
  return citeEvidence({
    snapshotId, sourceId, contentHash: digest(sourceId), extraction, locator: { kind: 'json', pointer: '' },
  });
}

function captureOf(options: {
  source?: SourceDefinition;
  files: readonly StoredSourceFile[];
  extraFileCitations?: readonly EvidenceRef[];
  apiCitations?: readonly EvidenceRef[];
  sourceAccounts: readonly { sellerEntityId: Id; sourceAccountId: Id }[];
  asOf?: IsoInstant;
  binding?: DiscoveryBinding;
}): { capture: DocumentApplicabilityCapture; source: SourceDefinition; binding: DiscoveryBinding } {
  const source = options.source ?? companyA;
  const binding = options.binding ?? bind(source);
  const fileCitations = [
    ...documentCitations(binding.snapshotId, options.files), ...(options.extraFileCitations ?? []),
  ];
  const apiCitations = (options.apiCitations ?? []).map(evidence => ({ evidence }));
  const evidenceIds = [...fileCitations.map(citation => citation.id), ...apiCitations.map(({ evidence }) => evidence.id)]
    .sort();
  return {
    source, binding,
    capture: {
      facts: {
        binding,
        sourceAccounts: options.sourceAccounts.map(account => ({ kind: 'source_account' as const, ...account })),
        evidenceIds,
      },
      files: options.files, fileCitations, apiCitations, manifest: { asOf: options.asOf ?? asOf },
    },
  };
}

function pageCitation(capture: DocumentApplicabilityCapture, file: StoredSourceFile, page = 1): EvidenceRef {
  const citation = capture.fileCitations.find(entry =>
    entry.sourceId === file.file_id && entry.locator.kind === 'pdf' && entry.locator.page === page);
  if (!citation) throw new Error('missing pdf citation');
  return citation;
}

function fileCitation(capture: DocumentApplicabilityCapture, file: StoredSourceFile): EvidenceRef {
  const citation = capture.fileCitations.find(entry => entry.sourceId === file.file_id);
  if (!citation) throw new Error('missing file citation');
  return citation;
}

function associationFor(
  file: StoredSourceFile, citation: EvidenceRef, seller: Id, account: Id,
): DocumentAssociation {
  const document = file.extraction.document;
  if (document.kind !== 'pdf') throw new Error('expected pdf');
  return {
    evidenceId: citation.id, fileId: file.file_id, documentId: file.metadata.documentId,
    documentVersion: file.metadata.documentVersion, originalHash: file.content_hash,
    locator: { kind: 'pdf', page: 1, start: 0, end: document.pages[0]!.length },
    subject: { kind: 'source_account', sellerEntityId: seller, sourceAccountId: account },
  };
}

function expectUnresolved(
  result: ReturnType<typeof partitionDocumentApplicability>, ids: readonly Id[],
) {
  expect(result.associations).toEqual([]);
  expect(result.unresolvedEvidenceIds).toEqual([...ids].sort());
}

function expectThrown(run: () => unknown, status: number, code: string) {
  let value: unknown;
  try {
    value = run();
  } catch (error) {
    expect(error).toMatchObject({ status, code });
    expect(error).not.toHaveProperty('associations');
    return;
  }
  expect.fail('expected SourceError ' + code + ' but returned ' + JSON.stringify(value));
}

function grammarCapture(source: SourceDefinition, format: 'a' | 'b', fee = '1234.56') {
  const fields = party(source.sellerEntityId);
  const text = agreementText({ format, ...fields, fee });
  const parsed = parseAgreement({ text, citationId: 'fixture' }, asOf);
  expect(parsed).toMatchObject({
    contractId: fields.contract, sellerEntityId: fields.seller, sourceBuyerId: fields.buyer,
    sourceAccountId: fields.account, displayName: fields.name,
  });
  const binding = bind(source);
  const file = pdfFile(binding, 'contract_pdf', [text]);
  const { capture } = captureOf({
    source, binding, files: [file],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const citation = pageCitation(capture, file);
  return { capture, source, file, citation, fields, expected: associationFor(file, citation, fields.seller, fields.account) };
}

it('associates a format A agreement with the exact catalog and captured source-account tuple', () => {
  const { capture, source, citation, fields, expected } = grammarCapture(companyA, 'a');
  const result = partitionDocumentApplicability(capture, source, [citation.id]);
  expect(result.associations).toEqual([expected]);
  expect(result.unresolvedEvidenceIds).toEqual([]);
  expect(result.associations[0]).toEqual({
    evidenceId: citation.id, fileId: expected.fileId, documentId: expected.documentId,
    documentVersion: 1, originalHash: expected.originalHash,
    locator: expected.locator,
    subject: { kind: 'source_account', sellerEntityId: fields.seller, sourceAccountId: fields.account },
  });
});

it('associates a format B agreement with the exact catalog and captured source-account tuple', () => {
  const { capture, source, citation, expected } = grammarCapture(companyB, 'b');
  const result = partitionDocumentApplicability(capture, source, [citation.id]);
  expect(result.associations).toEqual([expected]);
  expect(result.unresolvedEvidenceIds).toEqual([]);
});

it('keeps association after an amount change and omits fee from the result', () => {
  const source = companyA;
  const fields = party(source.sellerEntityId);
  const binding = bind(source);
  const documentId = id('doc');
  const accounts = [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }];
  const firstFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields, fee: '1234.56' })], {
    documentId, contentHash: digest('fee-a'),
  });
  const secondFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields, fee: '9999.00' })], {
    documentId, contentHash: digest('fee-b'),
  });
  const first = captureOf({ source, binding, files: [firstFile], sourceAccounts: accounts });
  const second = captureOf({ source, binding, files: [secondFile], sourceAccounts: accounts });
  const firstCitation = pageCitation(first.capture, firstFile);
  const secondCitation = pageCitation(second.capture, secondFile);
  expect(firstCitation.id).toBe(secondCitation.id);
  const firstResult = partitionDocumentApplicability(first.capture, source, [firstCitation.id]);
  const secondResult = partitionDocumentApplicability(second.capture, source, [secondCitation.id]);
  const firstExpected = associationFor(firstFile, firstCitation, fields.seller, fields.account);
  const secondExpected = associationFor(secondFile, secondCitation, fields.seller, fields.account);
  expect(firstResult.associations).toEqual([firstExpected]);
  expect(secondResult.associations).toEqual([secondExpected]);
  expect({ ...firstExpected, originalHash: secondExpected.originalHash }).toEqual(secondExpected);
  expect(Object.keys(firstExpected).sort()).toEqual([
    'documentId', 'documentVersion', 'evidenceId', 'fileId', 'locator', 'originalHash', 'subject',
  ]);
  expect(JSON.stringify(firstResult)).not.toMatch(/1234\.56|9999\.00|Monthly/);
  expect(JSON.stringify(secondResult)).not.toMatch(/1234\.56|9999\.00|Monthly/);
});

it('lists unsupported grammar citations as unresolved without associations', () => {
  const source = companyA;
  const fields = party(source.sellerEntityId);
  const valid = agreementText({ format: 'a', ...fields });
  const binding = bind(source);
  const documents = [
    pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields, account: 'branch/4' })]),
    pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields, date: '2026-02-30' })]),
    pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields, date: '2026-10-02' })]),
    pdfFile(binding, 'contract_pdf', [valid + '\nAuthorize buyer other.']),
    pdfFile(binding, 'contract_pdf', ['Notice. ' + valid]),
    pdfFile(binding, 'contract_pdf', ['Fixed monthly agreement ' + fields.contract]),
    pdfFile(binding, 'contract_pdf', [valid.replace('USD', 'EUR')]),
    pdfFile(binding, 'contract_pdf', [valid.replace('anchor day 1.', 'anchor day 2.')]),
    pdfFile(binding, 'contract_pdf', [
      valid + ' ' + agreementText({ format: 'a', ...party(source.sellerEntityId) }),
    ]),
    pdfFile(binding, 'contract_pdf', [valid.replaceAll('  ', '\t')]),
  ];
  const { capture } = captureOf({
    source, binding, files: documents,
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const ids = documents.map(file => pageCitation(capture, file).id);
  expectUnresolved(partitionDocumentApplicability(capture, source, ids), ids);
});

it('requires the exact seller and captured event tuple and does not merge same-name accounts', () => {
  const source = companyA;
  const binding = bind(source);
  const first = party(source.sellerEntityId);
  const second = { ...party(source.sellerEntityId), name: first.name };
  const otherSeller = id('seller');
  const borrowed = { ...party(otherSeller), account: first.account };
  const catalogMismatch = party(id('foreign'));
  const noEvent = party(source.sellerEntityId);
  const firstFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...first })]);
  const secondFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...second })]);
  const otherSellerFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...borrowed })]);
  const mismatchFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...catalogMismatch })]);
  const noEventFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...noEvent })]);
  const sourceAccounts = [
    { sellerEntityId: first.seller, sourceAccountId: first.account },
    { sellerEntityId: second.seller, sourceAccountId: second.account },
    { sellerEntityId: borrowed.seller, sourceAccountId: borrowed.account },
    { sellerEntityId: catalogMismatch.seller, sourceAccountId: catalogMismatch.account },
  ];
  const { capture } = captureOf({ source, binding, files: [firstFile, secondFile, otherSellerFile, mismatchFile, noEventFile], sourceAccounts });
  const firstCitation = pageCitation(capture, firstFile);
  const secondCitation = pageCitation(capture, secondFile);
  const borrowedCitation = pageCitation(capture, otherSellerFile);
  const mismatchCitation = pageCitation(capture, mismatchFile);
  const noEventCitation = pageCitation(capture, noEventFile);
  const named = partitionDocumentApplicability(capture, source, [secondCitation.id, firstCitation.id]);
  expect(named.associations).toEqual([
    associationFor(firstFile, firstCitation, first.seller, first.account),
    associationFor(secondFile, secondCitation, second.seller, second.account),
  ].sort((left, right) => left.evidenceId < right.evidenceId ? -1 : 1));
  expect(named.unresolvedEvidenceIds).toEqual([]);
  expectUnresolved(partitionDocumentApplicability(capture, source, [borrowedCitation.id]), [borrowedCitation.id]);
  expectUnresolved(partitionDocumentApplicability(capture, source, [mismatchCitation.id]), [mismatchCitation.id]);
  const before = capture.facts.sourceAccounts;
  expectUnresolved(partitionDocumentApplicability(capture, source, [noEventCitation.id]), [noEventCitation.id]);
  expect(capture.facts.sourceAccounts).toEqual(before);
});

it('treats buyer or name conflicts and directory contradictions as unresolved for the affected tuple', () => {
  const source = companyA;
  const binding = bind(source);
  const shared = party(source.sellerEntityId);
  const renamed = { ...shared, contract: id('contract'), name: 'Other ' + id('nm') };
  const kept = party(source.sellerEntityId);
  const blocked = party(source.sellerEntityId);
  const nameA = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...shared })]);
  const nameB = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...renamed })]);
  const keptFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...kept })]);
  const blockedFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...blocked })]);
  const directoryBody = directoryText(source.sellerEntityId,
    kept.account + ' belongs to ' + kept.buyer + '; ' + blocked.account + ' belongs to ' + id('wrong'));
  const directoryFile = emailFile(binding, directoryBody);
  expect(parseDirectory({ text: directoryBody, citationId: 'directory' })).toHaveLength(2);
  const { capture } = captureOf({
    source, binding, files: [nameA, nameB, keptFile, blockedFile, directoryFile],
    sourceAccounts: [
      { sellerEntityId: shared.seller, sourceAccountId: shared.account },
      { sellerEntityId: kept.seller, sourceAccountId: kept.account },
      { sellerEntityId: blocked.seller, sourceAccountId: blocked.account },
    ],
  });
  const nameIds = [pageCitation(capture, nameA).id, pageCitation(capture, nameB).id];
  expectUnresolved(partitionDocumentApplicability(capture, source, nameIds), nameIds);
  const keptCitation = pageCitation(capture, keptFile);
  const blockedCitation = pageCitation(capture, blockedFile);
  const directoryCitation = fileCitation(capture, directoryFile);
  const directoryResult = partitionDocumentApplicability(
    capture, source, [blockedCitation.id, directoryCitation.id, keptCitation.id],
  );
  expect(directoryResult.associations).toEqual([
    associationFor(keptFile, keptCitation, kept.seller, kept.account),
  ]);
  expect(directoryResult.unresolvedEvidenceIds).toEqual([blockedCitation.id, directoryCitation.id].sort());
});

it('still blocks a tuple when a contradictory first page is hidden by an extra page', () => {
  const source = companyA;
  const binding = bind(source);
  const fields = party(source.sellerEntityId);
  const conflicting = { ...fields, contract: id('contract'), name: 'Other ' + id('nm') };
  const validFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields })]);
  const hiddenFile = pdfFile(binding, 'contract_pdf', [
    agreementText({ format: 'a', ...conflicting }), 'Additional unused page.',
  ]);
  const { capture } = captureOf({
    source, binding, files: [validFile, hiddenFile],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const validCitation = pageCitation(capture, validFile);
  const hiddenCitation = pageCitation(capture, hiddenFile, 1);
  expectUnresolved(
    partitionDocumentApplicability(capture, source, [validCitation.id, hiddenCitation.id]),
    [validCitation.id, hiddenCitation.id],
  );
});

it('leaves unknown prose unresolved and does not assign it an account', () => {
  const source = companyA;
  const binding = bind(source);
  const fields = party(source.sellerEntityId);
  const validFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields })]);
  const unknownFile = pdfFile(binding, 'contract_pdf', ['Unrelated correspondence about ' + fields.account]);
  const remittanceFile = emailFile(binding, 'Remittance advice for ' + fields.account + ' paid USD 12.00.');
  const { capture } = captureOf({
    source, binding, files: [validFile, unknownFile, remittanceFile],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const validCitation = pageCitation(capture, validFile);
  const unknownCitation = pageCitation(capture, unknownFile);
  const remittanceCitation = fileCitation(capture, remittanceFile);
  const result = partitionDocumentApplicability(
    capture, source, [remittanceCitation.id, unknownCitation.id, validCitation.id],
  );
  expect(result.associations).toEqual([associationFor(validFile, validCitation, fields.seller, fields.account)]);
  expect(result.unresolvedEvidenceIds).toEqual([unknownCitation.id, remittanceCitation.id].sort());
  expect(result.associations.every(entry => entry.subject.sourceAccountId === fields.account)).toBe(true);
});

it('returns captured unsupported kinds as unresolved instead of throwing', () => {
  const source = companyA;
  const binding = bind(source);
  const fields = party(source.sellerEntityId);
  const amendmentFile = pdfFile(binding, 'amendment_pdf', [amendmentText(fields.contract, fields.seller, fields.buyer)]);
  const directoryFile = emailFile(binding, directoryText(fields.seller, fields.account + ' belongs to ' + fields.buyer));
  const remittanceFile = emailFile(binding, 'Paid invoice batch for several accounts.');
  const accountlessFile = pdfFile(binding, 'contract_pdf', ['Fixed monthly agreement without an account line.']);
  const multiFile = pdfFile(binding, 'contract_pdf', [
    agreementText({ format: 'a', ...fields }), 'Second page of the same PDF.',
  ]);
  const csv = csvFile(binding);
  const api = apiCitation(binding.snapshotId);
  const { capture } = captureOf({
    source, binding, files: [amendmentFile, directoryFile, remittanceFile, accountlessFile, multiFile, csv],
    apiCitations: [api],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const ids = [
    fileCitation(capture, amendmentFile).id,
    fileCitation(capture, directoryFile).id,
    fileCitation(capture, remittanceFile).id,
    pageCitation(capture, accountlessFile).id,
    pageCitation(capture, multiFile, 2).id,
    fileCitation(capture, csv).id,
    api.id,
  ];
  expect(() => partitionDocumentApplicability(capture, source, ids)).not.toThrow();
  expectUnresolved(partitionDocumentApplicability(capture, source, ids), ids);
});

it('leaves a conflict-free multipage agreement unresolved even when its page-one citation is requested', () => {
  const source = companyA;
  const binding = bind(source);
  const fields = party(source.sellerEntityId);
  const multiFile = pdfFile(binding, 'contract_pdf', [
    agreementText({ format: 'a', ...fields }), 'Harmless extra page.',
  ]);
  const { capture } = captureOf({
    source, binding, files: [multiFile],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const pageOne = pageCitation(capture, multiFile, 1);
  expect(pageOne.locator).toMatchObject({ kind: 'pdf', page: 1, start: 0 });
  expectUnresolved(partitionDocumentApplicability(capture, source, [pageOne.id]), [pageOne.id]);
});

it('does not treat a shorter or later-page locator as the required full page-one citation', () => {
  const source = companyA;
  const binding = bind(source);
  const fields = party(source.sellerEntityId);
  const file = pdfFile(binding, 'contract_pdf', [
    agreementText({ format: 'a', ...fields }), 'Trailing page that must not lend a range.',
  ]);
  const shortLocator = { kind: 'pdf' as const, page: 1, start: 0, end: 5 };
  const shortCitation = citeEvidence({
    snapshotId: binding.snapshotId, sourceId: file.file_id, contentHash: file.content_hash,
    extraction: file.extraction, locator: shortLocator,
  });
  const { capture } = captureOf({
    source, binding, files: [file], extraFileCitations: [shortCitation],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const pageTwo = pageCitation(capture, file, 2);
  expect(shortCitation.locator).toEqual(shortLocator);
  expectUnresolved(partitionDocumentApplicability(capture, source, [shortCitation.id]), [shortCitation.id]);
  expectUnresolved(partitionDocumentApplicability(capture, source, [pageTwo.id]), [pageTwo.id]);
});

it('partitions mixed valid and unsupported IDs completely, without duplicates, sorted by evidence ID', () => {
  const source = companyA;
  const binding = bind(source);
  const fields = party(source.sellerEntityId);
  const validFile = pdfFile(binding, 'contract_pdf', [agreementText({ format: 'a', ...fields })]);
  const amendmentFile = pdfFile(binding, 'amendment_pdf', [amendmentText(fields.contract, fields.seller, fields.buyer)]);
  const unknownFile = emailFile(binding, 'Unparsed operator note.');
  const { capture } = captureOf({
    source, binding, files: [validFile, amendmentFile, unknownFile],
    sourceAccounts: [{ sellerEntityId: fields.seller, sourceAccountId: fields.account }],
  });
  const validCitation = pageCitation(capture, validFile);
  const amendmentCitation = fileCitation(capture, amendmentFile);
  const unknownCitation = fileCitation(capture, unknownFile);
  const requested = [unknownCitation.id, validCitation.id, amendmentCitation.id];
  const result = partitionDocumentApplicability(capture, source, requested);
  const associatedIds = result.associations.map(entry => entry.evidenceId);
  const combined = [...associatedIds, ...result.unresolvedEvidenceIds];
  expect(associatedIds).toEqual([validCitation.id]);
  expect(result.associations).toEqual([associationFor(validFile, validCitation, fields.seller, fields.account)]);
  expect(result.unresolvedEvidenceIds).toEqual([amendmentCitation.id, unknownCitation.id].sort());
  expect(associatedIds).toEqual([...associatedIds].sort());
  expect(result.unresolvedEvidenceIds).toEqual([...result.unresolvedEvidenceIds].sort());
  expect(combined.sort()).toEqual([...requested].sort());
  expect(new Set(combined).size).toBe(requested.length);
});

it('rejects oversized, duplicate, and schema-invalid applicability requests', () => {
  const binding = bind(companyA);
  const grant = wideGrant(binding);
  const fiftyOne = Array.from({ length: 51 }, () => id('ev'));
  expectThrown(
    () => validateDocumentApplicabilityRequest({ binding, sourceRead: grant, evidenceIds: fiftyOne }),
    400, 'SOURCE_CONTENT_INVALID',
  );
  const duplicate = id('ev');
  expectThrown(
    () => validateDocumentApplicabilityRequest({ binding, sourceRead: grant, evidenceIds: [duplicate, duplicate] }),
    400, 'SOURCE_CONTENT_INVALID',
  );
  expectThrown(
    () => validateDocumentApplicabilityRequest({
      binding: { ...binding, companyId: 'bad/id' }, sourceRead: grant, evidenceIds: [id('ev')],
    }),
    400, 'SOURCE_CONTENT_INVALID',
  );
  expectThrown(
    () => validateDocumentApplicabilityRequest({
      binding, sourceRead: { ...grant, sourceWide: false, accounts: [] }, evidenceIds: [id('ev')],
    } as DocumentApplicabilityRequest),
    400, 'SOURCE_CONTENT_INVALID',
  );
});

it('forbids account-only grants before returning any association partition', () => {
  const binding = bind(companyA);
  const sourceRead = accountGrant(binding, companyA.sellerEntityId, id('acct'));
  expectThrown(
    () => validateDocumentApplicabilityRequest({ binding, sourceRead, evidenceIds: [id('ev')] }),
    403, 'SOURCE_FORBIDDEN',
  );
});

it('forbids a grant that does not match the requested binding', () => {
  const binding = bind(companyA);
  const sourceRead = { ...wideGrant(binding), companyId: companyB.companyId, sourceRef: companyB.sourceRef };
  expectThrown(
    () => validateDocumentApplicabilityRequest({ binding, sourceRead, evidenceIds: [id('ev')] }),
    403, 'SOURCE_FORBIDDEN',
  );
});

it('forbids a foreign evidence ID instead of listing it as unresolved', () => {
  const { capture, source, citation } = grammarCapture(companyA, 'a');
  const foreign = id('ev');
  expect(capture.facts.evidenceIds).not.toContain(foreign);
  expectThrown(
    () => partitionDocumentApplicability(capture, source, [citation.id, foreign]),
    403, 'SOURCE_FORBIDDEN',
  );
});

it('conflicts when a facts evidence ID has no citation membership', () => {
  const { capture, source, citation } = grammarCapture(companyA, 'a');
  const orphan = id('ev');
  const broken = {
    ...capture,
    facts: { ...capture.facts, evidenceIds: [...capture.facts.evidenceIds, orphan].sort() },
  };
  expectThrown(
    () => partitionDocumentApplicability(broken, source, [citation.id, orphan]),
    409, 'SOURCE_HASH_CONFLICT',
  );
});
