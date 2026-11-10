import { expect, test } from 'vitest';
import { LocalSessionResponseSchema } from '@eapr/contracts';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { CorrectionReject, createReviewPlugin, inventedMoneyCorrection } from '../../apps/control/src/routes/review.js';
import { ReviewError } from '../../apps/control/src/review-repository.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

const webOrigin = 'http://127.0.0.1:5173';
const accountId = 'account-corrections-a';

async function ledgerSnapshot(system: Awaited<ReturnType<typeof createTestSystem>>) {
  const control = await system.db.control.query<{
    prepared: string; intents: string; observations: string;
  }>(`SELECT
      (SELECT count(*)::text FROM prepared_reviews) AS prepared,
      (SELECT count(*)::text FROM activation_intents) AS intents,
      (SELECT count(*)::text FROM activation_receipt_observations) AS observations`);
  const runtime = await system.db.runtime.query<{
    imports: string; scopes: string;
  }>(`SELECT
      (SELECT count(*)::text FROM runtime_activation_imports) AS imports,
      (SELECT count(*)::text FROM parent_scopes) AS scopes`);
  return { control: control.rows[0]!, runtime: runtime.rows[0]! };
}

test('unsupported invented money stays blocked with no invented resolution write', async () => {
  expect(inventedMoneyCorrection({ amountCents: 999_99, rationale: 'invented price' })).toBe(true);
  expect(inventedMoneyCorrection({ note: 'cited transcription only' })).toBe(false);
  expect(() => { throw new CorrectionReject(422, 'UNSUPPORTED_AMOUNT'); }).toThrow(CorrectionReject);

  const preparation = {
    async prepare(): Promise<never> { throw new ReviewError(503, 'REVIEW_UNAVAILABLE'); },
    async get(): Promise<never> { throw new ReviewError(404, 'REVIEW_NOT_FOUND'); },
  };
  const system = await createTestSystem({
    modelMode: 'disabled',
    dbNamespace: testNamespace('v3corr'),
    controlPluginFactory: async () => {
      const session = createLocalSessionService({
        webOrigin,
        reviewerId: 'demo-reviewer',
        allowedSourceRefs: ['source-a'],
        allowedAccountIds: [accountId],
      });
      return [session.plugin, createReviewPlugin(preparation, session.authorizeReviewer)];
    },
  });

  try {
    const before = await ledgerSnapshot(system);
    const bootstrap = await fetch(system.control.origin + '/api/local-session', {
      method: 'POST',
      headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error',
    });
    expect(bootstrap.status).toBe(200);
    const setCookie = bootstrap.headers.getSetCookie();
    const cookie = setCookie.map(value => value.split(';')[0]).filter(Boolean).join('; ');
    const csrfToken = LocalSessionResponseSchema.parse(await bootstrap.json()).csrfToken;
    expect(cookie.length).toBeGreaterThan(0);

    const invented = await fetch(system.control.origin + '/api/review/' + accountId + '/corrections', {
      method: 'POST',
      headers: {
        origin: webOrigin, cookie, 'content-type': 'application/json', 'x-eapr-csrf': csrfToken,
      },
      body: JSON.stringify({ amountCents: 12_345, rationale: 'invented unsupported price' }),
      redirect: 'error',
    });
    expect(invented.status).toBe(422);
    expect(await invented.json()).toMatchObject({ code: 'UNSUPPORTED_AMOUNT' });

    const nonMoney = await fetch(system.control.origin + '/api/review/' + accountId + '/corrections', {
      method: 'POST',
      headers: {
        origin: webOrigin, cookie, 'content-type': 'application/json', 'x-eapr-csrf': csrfToken,
      },
      body: JSON.stringify({ note: 'no accepted correction authority yet' }),
      redirect: 'error',
    });
    expect(nonMoney.status).toBe(422);
    expect(await nonMoney.json()).toMatchObject({ code: 'CORRECTION_UNSUPPORTED' });

    expect(await ledgerSnapshot(system)).toEqual(before);
  } finally {
    await system.close();
  }
});
