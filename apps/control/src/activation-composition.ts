import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import type { createCandidateRegistry } from '@eapr/evaluator/registry';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { createActivationPublication } from './activation-publication.js';
import { createActivationReview } from './activation-review.js';
import { createFinancialCaptureReader, type FinancialSourceDependencies } from './financial-capture.js';
import type { ParentReadClient } from './parent-read-client.js';
import { createReviewPreparation } from './review-preparation.js';
import { createReviewProofSelection, loadReviewSelection, type BootstrapRoots } from './review-proof-selection.js';
import { createReviewRepository } from './review-repository.js';
import { createActivationReviewPlugin } from './routes/activation.js';
import { createReviewPlugin, type ReviewAuthorize } from './routes/review.js';
import type { composeSourceSemantics } from './source-semantics-composition.js';

export type LocalActivationOptions = {
  registryRoot: string;
  policyPath: string;
  selectionPath?: string;
  bootstrapRoots: BootstrapRoots;
};

export async function composeActivationReview(source: FinancialSourceDependencies, options: LocalActivationOptions & {
  candidates: Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;
  parent: ParentReadClient;
  observe: ReturnType<typeof composeSourceSemantics>['readCurrentSemantics'];
  authorize: ReviewAuthorize;
}) {
  const { registryRoot, candidates, parent, observe, authorize } = options;
  const { db, clock } = source.dependencies;
  const repository = createReviewRepository(db, clock);
  const policy = await loadActivationPolicy({ policyPath: options.policyPath }).catch(() => undefined);
  const selection = options.selectionPath
    ? await loadReviewSelection(options.selectionPath).catch(() => undefined)
    : undefined;
  const preparation = createReviewPreparation({
    repository, setup: policy && selection ? { policy, selection } : undefined,
    registered: createRegisteredScopeReader({ registryRoot }),
    captureReader: createFinancialCaptureReader({ ...source, registry: candidates }),
    financial: createFinancialAttestationRegistry(db, candidates),
    selectBootstrap: createReviewProofSelection(db, candidates, options.bootstrapRoots), parent, observe,
  });
  const publisher = createActivationPublication({ registryRoot, readCommittedIntent: repository.readCommittedIntent });
  return [
    createReviewPlugin(preparation, authorize),
    async app => {
      await app.register(createActivationReviewPlugin(createActivationReview({
        repository, preparation, publisher, publicationFailed: () => app.log.warn('ACTIVATION_PUBLICATION_PENDING'),
      }), authorize));
    },
  ] satisfies import('fastify').FastifyPluginAsync[];
}
