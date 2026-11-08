import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { EvidenceCitation } from '../../../apps/web/src/features/sources/EvidencePanel.js';
import { VerificationReport } from '../../../apps/web/src/features/preview/VerificationReport.js';
import type { VerificationSummary } from '../../contracts/src/review.js';

test('highlights the cited UTF-16 span as escaped text and links to the cited PDF page', () => {
  const hash = 'a'.repeat(64);
  const html = renderToStaticMarkup(createElement(EvidenceCitation, { response: {
    evidence: { id: 'ev-1', snapshotId: 'snap-1', sourceId: 'file-1',
      locator: { kind: 'pdf', page: 4, start: 3, end: 8 }, excerpt: '<tag>', sha256: hash },
    mediaType: 'application/pdf',
    original: { url: '/api/evidence/ev-1/content', sha256: hash, byteLength: 15 },
    text: { value: '📄 <tag> after', sha256: hash, unit: 'utf16', startInclusive: 3, endExclusive: 8 },
  } }));
  expect(html).toContain('<mark>&lt;tag&gt;</mark>');
  expect(html).toContain('/api/evidence/ev-1/content#page=4');
  expect(html).toContain('PDF page 4');
});

test('incomplete mandatory checks cannot display a completed result as eligible', () => {
  const hash = 'a'.repeat(64);
  const summary: VerificationSummary = {
    reportId: 'report-1', artifactHash: hash, profileHashes: [hash], manifestHash: hash,
    eligible: true, checks: [{ id: 'baseline_reconcile', status: 'passed', diagnosticCodes: [] }],
    coverageComplete: true,
  };
  const html = renderToStaticMarkup(createElement(VerificationReport, { job: {
    jobId: 'job-1', state: 'completed', summary, diagnostics: [],
  } }));
  expect(html).toContain('Mandatory coverage incomplete');
  expect(html).toContain('new record');
  expect(html).toContain('Unavailable');
  expect(html).not.toContain('Eligible for review');
});
