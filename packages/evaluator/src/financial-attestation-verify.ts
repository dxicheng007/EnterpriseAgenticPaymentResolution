import {
  CaptureAttestationV1Schema, FinancialAttestationV1Schema, canonicalJson, hashArtifact, hashCanonical,
  hashEvent, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashManifest, hashProfile,
} from '@eapr/contracts';
import {
  FinancialCaptureV1Schema, FinancialEvaluatorCompletionV1Schema, FinancialEvaluatorInputV1Schema,
  FinancialProbeInputV1Schema, FinancialProbeResultV1Schema,
  type FinancialCaptureV1, type FinancialEvaluatorInputV1, type FinancialProbeInputV1, type FinancialRequest,
} from './financial-attestation-protocol.js';
import { mandatoryChecks, validateReport } from './verify.js';

export type {
  FinancialAttestationLauncher, FinancialCaptureReader, FinancialCaptureV1, FinancialEvaluatorCompletionV1,
  FinancialEvaluatorInputV1, FinancialFixtureSelectionV1, FinancialProbeInputV1, FinancialProbeResultV1,
} from './financial-attestation-protocol.js';

export const financialEqual = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function mismatch(): never {
  throw new Error('FINANCIAL_ATTESTATION_MISMATCH');
}

export function deriveFinancialCapture(input: FinancialCaptureV1) {
  try {
    const { artifact, profiles, manifest, snapshot, events } = FinancialCaptureV1Schema.parse(input);
    const { companyId, sourceRef } = manifest;
    const profileHashes = profiles.map(profile => profile.hash);
    const eventIds = events.map(event => event.id);
    if (artifact.hash !== hashArtifact(artifact) || artifact.sourceRef !== sourceRef || artifact.normalizedPlan.sourceRef !== sourceRef ||
      manifest.hash !== hashManifest(manifest) || snapshot.sourceRef !== sourceRef || snapshot.manifestId !== manifest.id ||
      new Set(profiles.map(profile => profile.id)).size !== profiles.length ||
      new Set(profileHashes).size !== profiles.length ||
      !financialEqual(profileHashes, [...artifact.requiredProfileHashes].sort()) ||
      profiles.some(profile => profile.hash !== hashProfile(profile) || profile.sourceRef !== sourceRef ||
        profile.scope.companyId !== companyId) ||
      new Set(eventIds).size !== events.length || !financialEqual(eventIds, [...snapshot.eventIds].sort())) mismatch();

    const memberSnapshotIds = manifest.streams.map(stream => stream.snapshotId);
    if (new Set(memberSnapshotIds).size !== memberSnapshotIds.length || memberSnapshotIds.includes(snapshot.id)) mismatch();
    const streams = new Map(artifact.normalizedPlan.capture.map(stream => [stream.streamId, stream]));
    const byId = new Map(events.map(event => [event.id, event]));
    const streamMembers = manifest.streams.flatMap(({ streamId, resumeAfter, eventIds: members, snapshotHash }) => {
      const stream = streams.get(streamId);
      if (!stream || members.length !== Number(resumeAfter)) mismatch();
      const records = members.map((id, index) => {
        const event = byId.get(id);
        if (!event || event.sequence !== index + 1 || event.streamId !== streamId || event.sourceRef !== sourceRef ||
          event.rawIdentity.companyId !== companyId || !stream.resources.includes(event.resource) ||
          !Object.hasOwn(manifest.schemaVersions, event.resource) || manifest.schemaVersions[event.resource] !== event.schemaVersion ||
          event.contentHash !== hashEvent(event)) mismatch();
        return { id, contentHash: event.contentHash };
      });
      if (snapshotHash !== hashCanonical({ sourceRef, streamId, resumeAfter, events: records })) mismatch();
      return members;
    });
    const evidenceIds = [...snapshot.evidenceIds].sort();
    if (!financialEqual(eventIds, streamMembers.sort()) || new Set(evidenceIds).size !== evidenceIds.length ||
      snapshot.contentHash !== hashCanonical({
        manifestHash: manifest.hash, eventIds, evidenceIds,
        streams: [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
          .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
        files: [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1).map(({ fileId, sha256 }) => ({ fileId, sha256 })),
      })) mismatch();

    return CaptureAttestationV1Schema.parse({
      companyId, sourceRef, manifestId: manifest.id, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, snapshotObjectHash: hashCanonical(snapshot),
      eventsHash: hashCanonical(events),
    });
  } catch {
    return mismatch();
  }
}

export function bindFinancialRequest(request: FinancialRequest) {
  const capture = deriveFinancialCapture(request.capture);
  if (request.protocolVersion === 'financial-attestation-probe-1') {
    if (request.selection.snapshotHash !== capture.snapshotHash) mismatch();
  } else {
    const { reservation } = request;
    if (reservation.jobId !== request.jobId || reservation.hash !== hashFinancialReservation(reservation) ||
      reservation.artifactHash !== request.capture.artifact.hash ||
      !financialEqual(reservation.requiredProfileHashes, request.capture.profiles.map(profile => profile.hash)) ||
      !financialEqual(reservation.capture, capture)) mismatch();
  }
  return capture;
}

export function validateFinancialProbe(input: FinancialProbeInputV1, output: unknown) {
  try {
    const request = FinancialProbeInputV1Schema.parse(input);
    const result = FinancialProbeResultV1Schema.parse(output);
    if (result.jobId !== request.jobId || result.requestHash !== hashCanonical(request) ||
      result.evaluatorBuildHash !== request.evaluatorBuildHash ||
      result.evidencePin.fixtureSetId !== request.selection.fixtureSetId ||
      result.evidencePin.fixtureSetVersion !== request.selection.fixtureSetVersion ||
      !financialEqual(result.capture, bindFinancialRequest(request))) mismatch();
    return result;
  } catch {
    return mismatch();
  }
}

export function validateFinancialCompletion(input: FinancialEvaluatorInputV1, output: unknown) {
  try {
    const request = FinancialEvaluatorInputV1Schema.parse(input);
    const completion = FinancialEvaluatorCompletionV1Schema.parse(output);
    const { jobId, reservation } = request;
    if (completion.jobId !== jobId || completion.requestHash !== hashCanonical(request) ||
      completion.reservationHash !== reservation.hash || completion.evaluatorBuildHash !== reservation.evaluatorBuildHash ||
      !financialEqual(completion.capture, bindFinancialRequest(request)) ||
      !financialEqual(completion.evidencePin, reservation.evidencePin)) mismatch();
    const { report, summary } = validateReport(jobId, request.capture,
      { ...reservation.evidencePin, evaluatorBuildHash: reservation.evaluatorBuildHash }, completion.report);
    if (report.checks.length !== mandatoryChecks.length) mismatch();
    const proof = { schemaVersion: '1' as const, reservation, reportId: report.id, reportHash: hashFinancialReport(report) };
    const attestation = FinancialAttestationV1Schema.parse({ ...proof, hash: hashFinancialAttestation(proof) });
    return { completion: { ...completion, report }, report, summary, attestation };
  } catch {
    return mismatch();
  }
}
