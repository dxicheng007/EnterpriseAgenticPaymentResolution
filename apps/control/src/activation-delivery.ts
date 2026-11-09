import type { ReceiptResponse } from '@eapr/contracts';
import type { createActivationPublication } from './activation-publication.js';
import type { ActivationWorkerClient } from './activation-worker-client.js';
import type { ReviewRepository } from './review-repository.js';

type Intent = NonNullable<Awaited<ReturnType<ReviewRepository['readCommittedIntent']>>>;

export function createActivationDelivery({ worker, publisher, repository, publicationFailed }: {
  worker: ActivationWorkerClient;
  publisher: ReturnType<typeof createActivationPublication>;
  repository: Pick<ReviewRepository, 'recordWorkerReceiptObservation'>;
  publicationFailed: () => void;
}) {
  return async function deliver(intent: Intent) {
    const { intentId, requestHash: expectedRequestHash, bundleHash: expectedBundleHash } = intent;
    const { idempotencyKey, reviewPackageId } = intent.request;
    const pending = { state: 'pending' as const, reviewPackageId, idempotencyKey };
    const observe = async (result: ReceiptResponse) => {
      await repository.recordWorkerReceiptObservation({
        intentId, expectedRequestHash, expectedBundleHash, receipt: result.receipt,
      });
      return result;
    };

    const recovered = await worker.receipt(idempotencyKey, {
      scope: intent.bundle.reviewPackage.scope, expectedRequestHash, expectedBundleHash,
    });
    if (recovered.status === 'receipt') return observe(recovered.result);
    if (recovered.status !== 'absent') return pending;

    let dispatch;
    try {
      dispatch = await publisher.publishIntent(intentId);
    } catch {
      publicationFailed();
      return pending;
    }
    const applied = await worker.activate(dispatch);
    return applied.status === 'receipt' ? observe(applied.result) : pending;
  };
}
