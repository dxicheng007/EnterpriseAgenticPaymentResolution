import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { hashCanonical } from '@eapr/contracts';
import { createActivationWorkerClient } from '../../../apps/control/src/activation-worker-client.js';
import { createLocalComposition } from '../../../apps/control/src/composition.js';
import { createParentReadClient } from '../../../apps/control/src/parent-read-client.js';
import { createReviewRepository, headToken } from '../../../apps/control/src/review-repository.js';
import type { ControlServices } from '../../../apps/control/src/server.js';
import { composeWorkerActivation } from '../../../apps/worker/src/activation-composition.js';
import { composeWorkerParentReads } from '../../../apps/worker/src/parent-read-composition.js';
import type { WorkerServices } from '../../../apps/worker/src/server.js';
import { localPort } from '../../../scripts/native-db.js';
import { issueActivationProofs } from '../../fixtures/activation-proof.js';

/** Mutable proof handle filled during control composition, then used to remount the worker. */
export type ReviewActivationProofs = Awaited<ReturnType<typeof issueActivationProofs>>;

export function createReviewActivationMount(root: string, webOrigin: string) {
  const controlOrigin = 'http://127.0.0.1:' + localPort('EAPR_CONTROL_PORT', 3001);
  const workerOrigin = 'http://127.0.0.1:' + localPort('EAPR_WORKER_PORT', 3002);
  const sourceReadToken = randomBytes(32).toString('hex');
  let serviceToken = '';
  let proofs: ReviewActivationProofs | undefined;

  const workerPlugins: FastifyPluginAsync<WorkerServices>[] = [async (app, services) => {
    serviceToken = services.serviceToken;
    if (!proofs) return;
    if (serviceToken === sourceReadToken) throw new Error('Worker and source capabilities must be distinct');
    await composeWorkerParentReads(proofs.registryRoot)(app, services);
    await composeWorkerActivation({
      registryRoot: proofs.registryRoot,
      policyPath: proofs.policyPath,
      sourceOrigin: controlOrigin,
      sourceReadToken,
      sourceRefs: [proofs.a.sourceRef, proofs.b.sourceRef],
    })(app, services);
  }];

  async function controlPlugins({ db, clock }: ControlServices): Promise<FastifyPluginAsync<ControlServices>[]> {
    proofs = await issueActivationProofs(root, db);
    const parentReads = createParentReadClient(workerOrigin, serviceToken, proofs.registryRoot);
    const worker = createActivationWorkerClient(workerOrigin, serviceToken);
    const composition = await createLocalComposition({ ...proofs.dependencies, clock }, {
      webOrigin,
      captures: [proofs.a.capture, proofs.b.capture],
      registry: proofs.candidates,
      parentReads,
      sourceReadToken,
      activationReview: {
        registryRoot: proofs.registryRoot,
        policyPath: proofs.policyPath,
        selectionPath: proofs.selectionPath,
        bootstrapRoots: proofs.bootstrapRoots,
        worker,
      },
    });
    return composition.featurePlugins;
  }

  async function forceStaleReview(db: Pool, accountId: string) {
    const repository = createReviewRepository(db, () => new Date());
    const head = await repository.readHead(accountId);
    if (!head) throw new Error('No prepared review head to stale');
    const { id: _id, hash: _hash, revision: _revision, ...fields } = head.review;
    await repository.savePreparation(headToken(head.review), {
      fields,
      sourceRef: head.sourceRef,
      fingerprint: hashCanonical(['browser-stale', accountId, String(Date.now())]),
      companion: head.companion,
    });
  }

  return {
    workerPlugins,
    controlPlugins,
    forceStaleReview,
    accounts: () => {
      if (!proofs) throw new Error('Activation proofs are not ready');
      return { a: proofs.a.accountId, b: proofs.b.accountId };
    },
  };
}
