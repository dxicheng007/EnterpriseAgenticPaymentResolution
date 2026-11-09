import { BootstrapPinV1Schema, type BootstrapPinV1 } from '@eapr/contracts';
import type { BootstrapEvaluatorInputV1, BootstrapLauncher } from './bootstrap-protocol.js';
import type { createBootstrapVerificationRegistry } from './bootstrap-registry.js';
import type { createCandidateRegistry } from './registry.js';

type CandidateReader = Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;
type BootstrapRegistry = ReturnType<typeof createBootstrapVerificationRegistry>;
type JobInput = Pick<BootstrapEvaluatorInputV1, 'selectedProfileHash' | 'events' | 'target'> & {
  artifactHash: string;
  manifestId: string;
};

export function createBootstrapVerificationJobs(options: {
  candidates: CandidateReader;
  registry: BootstrapRegistry;
  launcher: BootstrapLauncher;
  pin: BootstrapPinV1;
}) {
  const { candidates, registry, launcher } = options;
  const pin = BootstrapPinV1Schema.parse(options.pin);

  return {
    async reserve(input: JobInput) {
      const { artifact, profiles, manifest, snapshot } = await candidates.getCandidate(input.artifactHash, input.manifestId);
      return registry.reserveBootstrapVerification({
        protocolVersion: 'bootstrap-1', pin, artifact, profiles, manifest, snapshot,
        selectedProfileHash: input.selectedProfileHash, events: input.events, target: input.target,
      });
    },

    async execute(jobId: string) {
      const request = await registry.startBootstrapVerification(jobId);
      try {
        const completion = await launcher.launch(request);
        await registry.completeBootstrapVerification(jobId, completion);
      } catch {
        await registry.failBootstrapVerification(jobId);
        throw new Error('BOOTSTRAP_VERIFICATION_UNAVAILABLE');
      }
    },
  };
}
