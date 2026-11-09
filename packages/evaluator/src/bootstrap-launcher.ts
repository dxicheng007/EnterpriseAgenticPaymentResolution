import { BootstrapPinV1Schema, hashCanonical, type BootstrapPinV1 } from '@eapr/contracts';
import { BootstrapEvaluatorInputV1Schema, type BootstrapEvaluatorInputV1, type BootstrapLauncher } from './bootstrap-protocol.js';
import {
  BootstrapLaunchContextV1Schema, BootstrapRootsSchema, readBootstrapBuildPins, requireBootstrapBuildPins, runBootstrapEvaluator,
} from './bootstrap-runner.js';
import { bootstrapEqual, deriveBootstrapBinding, validateBootstrapCompletion } from './bootstrap-verify.js';

// Keep the production digest reader bound to this checkout.
export const readFixedBootstrapBuildPins = () => readBootstrapBuildPins();
export type { BootstrapEvaluatorCompletionV1, BootstrapEvaluatorInputV1, BootstrapLauncher } from './bootstrap-protocol.js';

type RegisteredCandidate = Pick<BootstrapEvaluatorInputV1, 'artifact' | 'profiles' | 'manifest' | 'snapshot'>;
type TrustedBootstrapLauncherOptions = {
  registry: { getCandidate(artifactHash: string, manifestId: string): Promise<RegisteredCandidate> };
  pin: BootstrapPinV1;
  roots: { sidecarRoot: string; evidencePinRoot: string; servedRoots: string[] };
};

export function createProtectedBootstrapLauncher(options: TrustedBootstrapLauncherOptions): BootstrapLauncher {
  const { registry } = options;
  const pin = BootstrapPinV1Schema.safeParse(options.pin);
  const roots = BootstrapRootsSchema.safeParse(options.roots);
  if (!pin.success || !roots.success) throw new Error('INPUT_INVALID');

  return {
    async launch(input) {
      const parsed = BootstrapEvaluatorInputV1Schema.safeParse(input);
      if (!parsed.success) throw new Error('INPUT_INVALID');
      const request = parsed.data;
      let context;
      try {
        const { artifact, profiles, manifest, snapshot } = request;
        if (!bootstrapEqual(request.pin, pin.data)) throw new Error();
        deriveBootstrapBinding(request);
        const candidate = await registry.getCandidate(artifact.hash, manifest.id);
        if (!bootstrapEqual(candidate.artifact, artifact) || !bootstrapEqual(candidate.manifest, manifest) ||
          !bootstrapEqual(candidate.snapshot, snapshot) || !bootstrapEqual(candidate.profiles, profiles)) throw new Error();
        context = BootstrapLaunchContextV1Schema.parse({
          protocolVersion: 'bootstrap-launch-context-1', requestHash: hashCanonical(request),
          registration: {
            artifactHash: candidate.artifact.hash, manifestHash: candidate.manifest.hash,
            snapshotId: candidate.snapshot.id, snapshotObjectHash: hashCanonical(candidate.snapshot),
          },
          roots: roots.data,
        });
      } catch {
        throw new Error('REQUEST_MISMATCH');
      }
      await requireBootstrapBuildPins(pin.data);
      const completion = await runBootstrapEvaluator(request, context);
      if (!completion.ok) throw new Error(completion.code);
      await requireBootstrapBuildPins(pin.data);
      return validateBootstrapCompletion(request, completion.value);
    },
  };
}
