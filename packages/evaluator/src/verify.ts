import {
  VerificationCheckIdSchema, VerificationReportSchema,
  type BootstrapManifest, type CompiledArtifact, type CustomerProfile, type VerificationReport, type VerificationSummary,
} from '@eapr/contracts';

export const mandatoryChecks = Object.freeze([...VerificationCheckIdSchema.options]);

export type VerificationSubject = {
  artifact: CompiledArtifact;
  profiles: CustomerProfile[];
  manifest: BootstrapManifest;
};

export type VerificationPin = Pick<VerificationReport, 'fixtureSetId' | 'fixtureSetVersion' | 'evaluatorBuildHash'>;

function equalSet(left: readonly string[], right: readonly string[]): boolean {
  return new Set(left).size === left.length && new Set(right).size === right.length &&
    left.length === right.length && left.every(value => right.includes(value));
}

/** Bind a report from the trusted evaluator transport to the reserved job and immutable subject. */
export function validateReport(jobId: string, subject: VerificationSubject, pin: VerificationPin, value: unknown): {
  report: VerificationReport; summary: VerificationSummary;
} {
  const report = VerificationReportSchema.parse(value);
  const profileHashes = subject.profiles.map(profile => profile.hash);
  const coveredKinds = report.coverage.eventKinds;
  const requestedKinds = subject.artifact.normalizedPlan.allowedKinds;
  const executed = report.checks.filter(check => check.status !== 'unavailable').map(check => check.id);
  if (report.id !== 'report:' + jobId || report.artifactHash !== subject.artifact.hash ||
    report.manifestHash !== subject.manifest.hash || report.evaluatorBuildHash !== pin.evaluatorBuildHash ||
    report.fixtureSetId !== pin.fixtureSetId || report.fixtureSetVersion !== pin.fixtureSetVersion ||
    !equalSet(report.profileHashes, profileHashes) || !equalSet(report.coverage.profileHashes, profileHashes) ||
    !equalSet(report.coverage.sourceRefs, [subject.artifact.sourceRef]) ||
    !coveredKinds.every(kind => requestedKinds.includes(kind)) ||
    !equalSet(report.coverage.required, mandatoryChecks) || !equalSet(report.coverage.executed, executed) ||
    report.checks.some(check => (check.cases === 0) !== (check.status === 'unavailable'))) {
    throw new Error('Verification report binding failed');
  }
  const coverageComplete = equalSet(executed, mandatoryChecks) && equalSet(coveredKinds, requestedKinds);
  const eligible = coverageComplete && report.checks.every(check => check.status === 'passed') &&
    report.unexplainedDifferenceCents === 0;
  if (report.eligible !== eligible) throw new Error('Verification report eligibility failed');

  // Child diagnostic strings may contain protected details. Derive safe, fixed codes from statuses.
  const checks = report.checks.map(check => ({
    ...check,
    diagnosticCodes: check.status === 'passed' ? [] : [check.status === 'failed' ? 'CHECK_FAILED' : 'CHECK_UNAVAILABLE'],
  }));
  return {
    report: { ...report, checks },
    summary: {
      reportId: report.id, artifactHash: report.artifactHash, profileHashes: report.profileHashes,
      manifestHash: report.manifestHash, eligible, coverageComplete,
      checks: checks.map(({ cases: _cases, ...check }) => check),
    },
  };
}

export { createProtectedVerificationLauncher } from './launcher.js';
