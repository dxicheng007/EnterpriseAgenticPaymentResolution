import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ActivationRequestSchema, HashSchema, IdSchema, ReviewPackageSchema, SyncReceiptSchema,
  canonicalJson, hashCanonical, hashReviewPackage, type ActivationBundleV2, type ActivationRequest,
  type ReviewPackage, type SyncReceipt,
} from '@eapr/contracts';
import { withTransaction } from '@eapr/storage/transaction';
import { validateActivationBundleBytes } from '@eapr/storage/activation-registry';

export class ReviewError extends Error {
  constructor(readonly statusCode: 400 | 403 | 404 | 409 | 503, readonly code: string) { super(code); }
}
const conflict = (code: string) => new ReviewError(409, code);
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export type HeadToken = null | { packageId: string; revision: number; packageHash: string };
export const headToken = (review: ReviewPackage | undefined): HeadToken => review ? {
  packageId: review.id, revision: review.revision, packageHash: review.hash,
} : null;

type ReviewRow = {
  id: string; account_id: string; source_ref: string; revision: string; package_hash: string;
  fingerprint: string; package_canonical: string; companion_canonical: string; companion_digest: string;
};
type IntentRow = {
  id: string; account_id: string; source_ref: string; idempotency_key: string; package_id: string;
  request_hash: string; request_canonical: string; bundle_hash: string; bundle_canonical: string;
  bundle_digest: string; committed_at: Date;
};
type ObservationRow = { receipt_id: string; receipt_canonical: string; receipt_digest: string; observed_at: Date };
type ReviewFields = Omit<ReviewPackage, 'id' | 'hash' | 'revision'>;

export function createReviewRepository(db: Pool, clock: () => Date) {
  async function readHead(accountId: string, executor: Pool | PoolClient = db) {
    const { rows: [row] } = await executor.query<ReviewRow>(
      'SELECT r.* FROM review_heads h JOIN prepared_reviews r ON r.id = h.package_id WHERE h.account_id = $1', [accountId],
    );
    if (!row) return null;
    const review = ReviewPackageSchema.parse(JSON.parse(row.package_canonical));
    const companion: unknown = JSON.parse(row.companion_canonical);
    if (review.id !== row.id || review.scope.accountId !== row.account_id || review.revision !== Number(row.revision) ||
        review.hash !== row.package_hash || review.hash !== hashReviewPackage(review) ||
        canonicalJson(review) !== row.package_canonical || canonicalJson(companion) !== row.companion_canonical ||
        hashCanonical(companion) !== row.companion_digest) throw new ReviewError(503, 'REVIEW_UNAVAILABLE');
    return { review, companion, fingerprint: row.fingerprint, sourceRef: row.source_ref };
  }

  async function lockHead(client: PoolClient, accountId: string) {
    await client.query('INSERT INTO review_heads (account_id) VALUES ($1) ON CONFLICT DO NOTHING', [accountId]);
    await client.query('SELECT account_id FROM review_heads WHERE account_id = $1 FOR UPDATE', [accountId]);
    return readHead(accountId, client);
  }

  function decodeIntent(row: IntentRow) {
    const request = ActivationRequestSchema.parse(JSON.parse(row.request_canonical));
    const bundleBytes = Buffer.from(row.bundle_canonical);
    const bundle = validateActivationBundleBytes(bundleBytes, row.bundle_hash);
    if (canonicalJson(request) !== row.request_canonical || hashCanonical(request) !== row.request_hash ||
        hashCanonical(bundle) !== row.bundle_digest || !equal(bundle.request, request) ||
        request.idempotencyKey !== row.idempotency_key || request.reviewPackageId !== row.package_id ||
        bundle.reviewPackage.scope.accountId !== row.account_id || bundle.manifest.sourceRef !== row.source_ref) {
      throw new ReviewError(503, 'ACTIVATION_INTENT_UNAVAILABLE');
    }
    return {
      intentId: IdSchema.parse(row.id), request, requestHash: row.request_hash, bundleHash: row.bundle_hash, bundleBytes,
      bundle, reviewer: bundle.reviewer, sourceRef: row.source_ref, accountId: row.account_id,
      committedAt: row.committed_at.toISOString(),
    };
  }

  async function readCommittedIntent(intentId: string) {
    const { rows: [row] } = await db.query<IntentRow>('SELECT * FROM activation_intents WHERE id = $1', [IdSchema.parse(intentId)]);
    return row ? decodeIntent(row) : null;
  }

  async function readIntentByKey(key: string, executor: Pool | PoolClient = db) {
    const { rows: [row] } = await executor.query<IntentRow>('SELECT * FROM activation_intents WHERE idempotency_key = $1', [key]);
    return row ? decodeIntent(row) : null;
  }

  function validateReceipt(bundle: ActivationBundleV2, receipt: SyncReceipt) {
    const { previewPlan: plan } = bundle;
    const targetIds = plan.operations.filter(operation => !operation.op.startsWith('ensure_')).map(operation => operation.record.id);
    if (receipt.epoch !== 1 || receipt.artifactHash !== bundle.artifact.hash || receipt.planHash !== plan.hash ||
        !equal(receipt.scope, bundle.reviewPackage.scope) || !equal(receipt.eventIds, plan.eventIds) ||
        !equal(receipt.targetRecordIds, targetIds) || receipt.afterBalanceCents !== plan.expectedBalanceCents) {
      throw conflict('ACTIVATION_RECEIPT_MISMATCH');
    }
  }

  function decodeObservation(row: ObservationRow, bundle: ActivationBundleV2) {
    const receipt = SyncReceiptSchema.parse(JSON.parse(row.receipt_canonical));
    validateReceipt(bundle, receipt);
    if (receipt.id !== row.receipt_id || canonicalJson(receipt) !== row.receipt_canonical ||
        hashCanonical(receipt) !== row.receipt_digest) throw new ReviewError(503, 'ACTIVATION_OBSERVATION_UNAVAILABLE');
    return { receipt, observedAt: row.observed_at.toISOString() };
  }

  async function readObservation(executor: Pool | PoolClient, intentId: string) {
    const { rows: [row] } = await executor.query<ObservationRow>(
      'SELECT * FROM activation_receipt_observations WHERE intent_id = $1', [IdSchema.parse(intentId)],
    );
    return row;
  }

  return {
    readHead, readCommittedIntent, readIntentByKey,
    async savePreparation(token: HeadToken, input: {
      fields: ReviewFields; fingerprint: string; sourceRef: string; companion: unknown;
    }) {
      const accountId = input.fields.scope.accountId;
      return withTransaction(db, async client => {
        const current = await lockHead(client, accountId);
        if (!equal(headToken(current?.review), token)) throw conflict('STALE_REVIEW');
        if (current?.fingerprint === input.fingerprint) return current.review;
        const draft = { ...input.fields, id: randomUUID(), revision: (token?.revision ?? 0) + 1 };
        const review = ReviewPackageSchema.parse({ ...draft, hash: hashReviewPackage(draft) });
        await client.query(
          `INSERT INTO prepared_reviews
           (id, account_id, source_ref, revision, package_hash, fingerprint, package_canonical, companion_canonical, companion_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [review.id, accountId, input.sourceRef, review.revision, review.hash, input.fingerprint, canonicalJson(review),
            canonicalJson(input.companion), hashCanonical(input.companion)],
        );
        await client.query('UPDATE review_heads SET package_id = $2, revision = $3 WHERE account_id = $1',
          [accountId, review.id, review.revision]);
        return review;
      });
    },
    async commitIntent(token: HeadToken, bundle: ActivationBundleV2) {
      const { request, reviewPackage: review, manifest: { sourceRef } } = bundle;
      const accountId = review.scope.accountId;
      function checkExisting(intent: ReturnType<typeof decodeIntent>) {
        if (intent.accountId !== accountId || intent.sourceRef !== sourceRef || !equal(intent.request, request)) {
          throw conflict('IDEMPOTENCY_CONFLICT');
        }
        return intent;
      }
      return withTransaction(db, async client => {
        const current = await lockHead(client, accountId);
        const existing = await readIntentByKey(request.idempotencyKey, client);
        if (existing) return checkExisting(existing);
        if (!current || !equal(token, headToken(current.review)) || !equal(current.review, review) ||
            current.sourceRef !== sourceRef || !requestMatchesReview(request, review)) throw conflict('STALE_REVIEW');
        const { rows: [inserted] } = await client.query<IntentRow>(
          `INSERT INTO activation_intents
           (id, idempotency_key, account_id, source_ref, package_id, request_hash, request_canonical,
            bundle_hash, bundle_canonical, bundle_digest, committed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
          [randomUUID(), request.idempotencyKey, accountId, sourceRef, review.id, hashCanonical(request),
            canonicalJson(request), bundle.hash, canonicalJson(bundle), hashCanonical(bundle), clock().toISOString()],
        );
        if (inserted) return decodeIntent(inserted);
        const winner = await readIntentByKey(request.idempotencyKey, client);
        if (!winner) throw new ReviewError(503, 'ACTIVATION_INTENT_UNAVAILABLE');
        return checkExisting(winner);
      });
    },
    async recordWorkerReceiptObservation(input: {
      intentId: string; expectedRequestHash: string; expectedBundleHash: string; receipt: SyncReceipt;
    }) {
      const intent = await readCommittedIntent(input.intentId);
      const receipt = SyncReceiptSchema.parse(input.receipt);
      if (!intent || intent.requestHash !== HashSchema.parse(input.expectedRequestHash) ||
          intent.bundleHash !== HashSchema.parse(input.expectedBundleHash)) throw conflict('ACTIVATION_RECEIPT_MISMATCH');
      validateReceipt(intent.bundle, receipt);
      const canonical = canonicalJson(receipt);
      return withTransaction(db, async client => {
        await client.query(
          `INSERT INTO activation_receipt_observations (intent_id, receipt_id, receipt_canonical, receipt_digest, observed_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [intent.intentId, receipt.id, canonical, hashCanonical(receipt), clock().toISOString()],
        );
        const row = await readObservation(client, intent.intentId);
        if (!row || row.receipt_canonical !== canonical) throw conflict('ACTIVATION_RECEIPT_CONFLICT');
        return decodeObservation(row, intent.bundle);
      });
    },
    async readWorkerReceiptObservation(intentId: string) {
      const row = await readObservation(db, intentId);
      if (!row) return null;
      const intent = await readCommittedIntent(intentId);
      if (!intent) throw new ReviewError(503, 'ACTIVATION_OBSERVATION_UNAVAILABLE');
      return decodeObservation(row, intent.bundle);
    },
  };
}

export function requestMatchesReview(request: ActivationRequest, review: ReviewPackage) {
  return review.ready && request.reviewPackageId === review.id && request.expectedPackageHash === review.hash &&
    request.expectedArtifactHash === review.artifactHash && request.expectedProfileHash === review.profileHash &&
    request.expectedTargetVersion === review.expectedTargetVersion;
}

export type ReviewRepository = ReturnType<typeof createReviewRepository>;
