import { expect, test } from 'vitest';
import { hashCanonical } from '@eapr/contracts';
import { createReviewRepository, headToken } from '../../apps/control/src/review-repository.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

test('native preparation CAS serializes absent heads, preserves identical bytes and rejects stale present tokens', async () => {
  const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('a4heads') });
  try {
    const repository = createReviewRepository(system.db.control, () => new Date());
    const scope = { companyId: 'test-company', sellerEntityId: 'test-seller', accountId: 'test-account' };
    const input = {
      fields: {
        scope, artifactHash: hashCanonical('artifact'), profileHash: hashCanonical('profile'),
        manifestHash: hashCanonical('manifest'), verificationReportId: 'synthetic-report',
        previewPlanHash: hashCanonical('plan'), expectedTargetVersion: 0, diagnostics: [], ready: false,
      },
      fingerprint: hashCanonical('preparation'), sourceRef: 'test-source',
      companion: { observation: 'original observation' },
    };
    const firstAttempts = await Promise.allSettled([
      repository.savePreparation(null, input),
      repository.savePreparation(null, input),
    ]);
    expect(firstAttempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    const loser = firstAttempts.find(attempt => attempt.status === 'rejected');
    expect(loser).toMatchObject({ reason: { code: 'STALE_REVIEW' } });
    const first = (await repository.readHead(scope.accountId))!;
    expect(first.review.revision).toBe(1);
    const token = headToken(first.review);
    const identical = await repository.savePreparation(token, { ...input, companion: { observation: 'later observation' } });
    expect(identical).toEqual(first.review);
    expect((await repository.readHead(scope.accountId))?.companion).toEqual(input.companion);

    const pendingIO = Promise.withResolvers<void>();
    const stalePreparation = pendingIO.promise.then(() => repository.savePreparation(token, input));
    const changed = await repository.savePreparation(token, { ...input, fingerprint: hashCanonical('changed') });
    expect(changed.revision).toBe(2);
    pendingIO.resolve();
    await expect(stalePreparation).rejects.toThrow('STALE_REVIEW');
    await expect(system.db.control.query('UPDATE prepared_reviews SET source_ref = $1', ['altered'])).rejects.toThrow(/permission denied/);
    await expect(system.db.control.query('DELETE FROM prepared_reviews')).rejects.toThrow(/permission denied/);
  } finally {
    await system.close();
  }
});
