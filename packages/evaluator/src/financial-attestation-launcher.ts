import { hashCanonical } from '@eapr/contracts';
import { readFinancialBuildHash } from './financial-attestation-build.js';
import {
  FinancialEvaluatorInputV1Schema, FinancialProbeInputV1Schema, FinancialRootsSchema,
  type FinancialAttestationLauncher, type FinancialCaptureV1, type FinancialRequest,
} from './financial-attestation-protocol.js';
import { runFinancialEvaluator } from './financial-attestation-runner.js';
import {
  bindFinancialRequest, financialEqual, validateFinancialCompletion, validateFinancialProbe,
} from './financial-attestation-verify.js';

export type {
  FinancialAttestationLauncher, FinancialCaptureReader, FinancialCaptureV1, FinancialEvaluatorCompletionV1,
  FinancialEvaluatorInputV1, FinancialFixtureSelectionV1, FinancialProbeInputV1, FinancialProbeResultV1,
} from './financial-attestation-protocol.js';

export const readFixedFinancialBuildHash = () => readFinancialBuildHash();

type RegisteredCandidate = Omit<FinancialCaptureV1, 'events'>;
type TrustedFinancialLauncherOptions = {
  registry: { getCandidate(artifactHash: string, manifestId: string): Promise<RegisteredCandidate> };
  roots: { evidencePinRoot: string; servedRoots: string[] };
};

export function createProtectedFinancialLauncher({ registry, roots }: TrustedFinancialLauncherOptions): FinancialAttestationLauncher {
  const parsedRoots = FinancialRootsSchema.safeParse(roots);
  if (!parsedRoots.success) throw new Error('FINANCIAL_ATTESTATION_UNAVAILABLE');
  const trustedRoots = parsedRoots.data;

  async function run(request: FinancialRequest, evaluatorBuildHash: string) {
    try {
      const { artifact, manifest, profiles, snapshot } = request.capture;
      bindFinancialRequest(request);
      const candidate = await registry.getCandidate(artifact.hash, manifest.id);
      if (!financialEqual(candidate.artifact, artifact) || !financialEqual(candidate.manifest, manifest) ||
        !financialEqual(candidate.snapshot, snapshot) ||
        !financialEqual([...candidate.profiles].sort((a, b) => a.hash < b.hash ? -1 : 1), profiles)) throw new Error();
    } catch {
      throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
    }

    if (await readFixedFinancialBuildHash() !== evaluatorBuildHash) throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
    const response = await runFinancialEvaluator(request, {
      protocolVersion: 'financial-attestation-context-1', requestHash: hashCanonical(request), roots: trustedRoots,
    });
    if (!response.ok) throw new Error(response.code === 'REQUEST_MISMATCH' ?
      'FINANCIAL_ATTESTATION_MISMATCH' : 'FINANCIAL_ATTESTATION_UNAVAILABLE');
    if (await readFixedFinancialBuildHash() !== evaluatorBuildHash) throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
    return response.value;
  }

  return {
    async probe(input) {
      const parsed = FinancialProbeInputV1Schema.safeParse(input);
      if (!parsed.success) throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
      return validateFinancialProbe(parsed.data, await run(parsed.data, parsed.data.evaluatorBuildHash));
    },
    async launch(input) {
      const parsed = FinancialEvaluatorInputV1Schema.safeParse(input);
      if (!parsed.success) throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
      return validateFinancialCompletion(parsed.data, await run(parsed.data, parsed.data.reservation.evaluatorBuildHash)).completion;
    },
  };
}
