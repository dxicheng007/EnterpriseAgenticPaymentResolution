import { ActivationRequestSchema, HashSchema, IdSchema, ReviewerContextSchema, canonicalJson,
  type ActivationRequest, type ReviewerContext,
} from '@eapr/contracts';
import {
  publishActivationBundle, publishRegisteredScopeMembers, validateActivationBundleBytes,
} from '@eapr/storage/activation-registry';
import type { createCandidateRegistry } from '@eapr/evaluator/registry';

export type RegisteredScopeSelection = { artifactHash: string; manifestId: string; selectedProfileHash: string };
type CandidateReader = Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;

export function createRegisteredScopePublication({ registryRoot, candidates }: { registryRoot: string; candidates: CandidateReader }) {
  return {
    async publishRegisteredScopes(selections: RegisteredScopeSelection[]) {
      try {
        const members = await Promise.all(selections.map(async selection => {
          const artifactHash = HashSchema.parse(selection.artifactHash);
          const manifestId = IdSchema.parse(selection.manifestId);
          const selectedProfileHash = HashSchema.parse(selection.selectedProfileHash);
          const { artifact, profiles, manifest } = await candidates.getCandidate(artifactHash, manifestId);
          const [profile, duplicate] = profiles.filter(member => member.hash === selectedProfileHash);
          if (!profile || duplicate || artifact.hash !== artifactHash || manifest.id !== manifestId ||
            !artifact.requiredProfileHashes.includes(profile.hash) || artifact.sourceRef !== manifest.sourceRef) {
            throw new Error('REGISTERED_SCOPE_MISMATCH');
          }
          return {
            profile, manifest,
            entry: {
              accountId: profile.scope.accountId, scope: profile.scope, profileHash: profile.hash,
              manifestId: manifest.id, manifestHash: manifest.hash, manifestAsOf: manifest.asOf,
            },
          };
        }));
        return await publishRegisteredScopeMembers({ registryRoot }, members);
      } catch {
        throw new Error('REGISTERED_SCOPE_PUBLICATION_FAILED');
      }
    },
  };
}

type CommittedIntent = {
  intentId: string; bundleHash: string; bundleBytes: Uint8Array;
  request: ActivationRequest; reviewer: ReviewerContext;
};

export function createActivationPublication({ registryRoot, readCommittedIntent }: {
  registryRoot: string; readCommittedIntent: (intentId: string) => Promise<CommittedIntent | null>;
}) {
  return {
    async publishIntent(intentId: string) {
      const intent = await readCommittedIntent(IdSchema.parse(intentId));
      if (!intent) throw new Error('ACTIVATION_INTENT_UNAVAILABLE');
      const { bundleHash, bundleBytes } = intent;
      const bundle = validateActivationBundleBytes(bundleBytes, bundleHash);
      const request = ActivationRequestSchema.safeParse(intent.request);
      const reviewer = ReviewerContextSchema.safeParse(intent.reviewer);
      if (intent.intentId !== intentId || !request.success || !reviewer.success ||
        canonicalJson(bundle.request) !== canonicalJson(request.data) ||
        canonicalJson(bundle.reviewer) !== canonicalJson(reviewer.data)) {
        throw new Error('ACTIVATION_BUNDLE_MISMATCH');
      }
      await publishActivationBundle({ registryRoot }, bundleHash, bundleBytes);
      return { bundleHash, idempotencyKey: request.data.idempotencyKey };
    },
  };
}
