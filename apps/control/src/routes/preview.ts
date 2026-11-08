import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  BootstrapManifestSchema, EvidenceRefSchema, IdSchema, PreviewRequestSchema, PreviewResponseSchema, RawSourceEventSchema,
  SourceDossierSchema, SourceSnapshotSchema, TargetStateSchema, hashCanonical, hashEvent, hashManifest, hashProfile,
  type ApiError, type CustomerProfile, type Diagnostic, type Hold, type PlanOutcome, type PreviewRequest,
  type PreviewResponse, type RawSourceEvent,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { planBatch } from '@eapr/compiler/plan-batch';
import type { CandidateRegistry, PreviewReadContext, SnapshotRead, SnapshotReader, TargetReader } from '@eapr/compiler/preview-adapters';
import { computeBalance } from '@eapr/finance/balance';
import { sameScope } from '@eapr/finance/validate';

export type PreviewDependencies = SnapshotReader & TargetReader & Partial<Pick<CandidateRegistry, 'registerCandidate'>> & {
  authorizeRead(request: FastifyRequest): Promise<PreviewReadContext>;
};

const failures = {
  400: { code: 'PREVIEW_INVALID', message: 'Preview request is malformed' },
  401: { code: 'PREVIEW_UNAUTHORIZED', message: 'Preview requires an authorized caller' },
  403: { code: 'PREVIEW_FORBIDDEN', message: 'Caller lacks the requested preview capability' },
  404: { code: 'PREVIEW_REFERENCE_NOT_FOUND', message: 'A required preview reference was not found' },
  409: { code: 'PREVIEW_REFERENCE_CONFLICT', message: 'A pinned preview reference conflicts with its contents or scope' },
  503: { code: 'PREVIEW_DEPENDENCY_UNAVAILABLE', message: 'A preview dependency is unavailable' },
} as const;
type FailureStatus = keyof typeof failures;

class PreviewFailure extends Error {
  constructor(readonly statusCode: FailureStatus) {
    super(failures[statusCode].message);
  }
}

function publicFailure(error: unknown): FailureStatus {
  const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) return status;
  if (status === 413 || status === 415) return 400;
  if (status === 422) return 409;
  return 503;
}

function equalIds(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    new Set(right).size === right.length && [...left].sort().every((id, index) => id === right[index]);
}

function verifyCapture(value: SnapshotRead, input: PreviewRequest): SnapshotRead {
  const snapshot = SourceSnapshotSchema.safeParse(value?.snapshot);
  const manifest = BootstrapManifestSchema.safeParse(value?.manifest);
  const dossier = SourceDossierSchema.safeParse(value?.dossier);
  const events = RawSourceEventSchema.array().safeParse(value?.events);
  const evidence = EvidenceRefSchema.array().safeParse(value?.evidence);
  if (!snapshot.success || !manifest.success || !dossier.success || !events.success || !evidence.success) {
    throw new PreviewFailure(409);
  }
  const capture: SnapshotRead = {
    snapshot: snapshot.data, manifest: manifest.data, dossier: dossier.data, events: events.data, evidence: evidence.data,
  };
  const { snapshot: aggregate, manifest: pinned, dossier: status } = capture;
  if (!status.complete) throw new PreviewFailure(404);
  if (aggregate.id !== input.snapshotId || aggregate.id !== 'snapshot:' + pinned.id ||
    aggregate.manifestId !== pinned.id || status.manifestId !== pinned.id || status.companyId !== pinned.companyId ||
    !status.snapshotIds.includes(aggregate.id) || status.missingMembers.length ||
    pinned.sourceRef !== input.spec.sourceRef || aggregate.sourceRef !== pinned.sourceRef ||
    input.profiles.some(profile => profile.sourceRef !== pinned.sourceRef || profile.scope.companyId !== pinned.companyId) ||
    pinned.hash !== hashManifest(pinned)) {
    throw new PreviewFailure(409);
  }
  const byStream = new Map<string, RawSourceEvent[]>();
  const eventIds = capture.events.map(event => event.id).sort();
  const evidenceIds = [...aggregate.evidenceIds].sort();
  if (!equalIds(aggregate.eventIds, eventIds) || !equalIds(status.evidenceIds, evidenceIds)) throw new PreviewFailure(409);
  for (const event of capture.events) {
    if (event.sourceRef !== pinned.sourceRef || event.rawIdentity.companyId !== pinned.companyId ||
      !Object.hasOwn(pinned.schemaVersions, event.resource) || pinned.schemaVersions[event.resource] !== event.schemaVersion ||
      event.contentHash !== hashEvent(event)) {
      throw new PreviewFailure(409);
    }
    const stream = byStream.get(event.streamId) ?? [];
    stream.push(event);
    byStream.set(event.streamId, stream);
  }
  const streams = [...pinned.streams].sort((left, right) => left.streamId < right.streamId ? -1 : 1).map(stream => {
    const { streamId, snapshotId, snapshotHash, resumeAfter } = stream;
    const members = (byStream.get(streamId) ?? []).sort((left, right) => left.sequence - right.sequence);
    byStream.delete(streamId);
    if (members.length !== Number(resumeAfter) || members.length !== stream.eventIds.length ||
      members.some((event, index) => event.id !== stream.eventIds[index] || event.sequence !== index + 1) ||
      snapshotHash !== hashCanonical({
        sourceRef: pinned.sourceRef, streamId, resumeAfter,
        events: members.map(({ id, contentHash }) => ({ id, contentHash })),
      })) {
      throw new PreviewFailure(409);
    }
    return { streamId, snapshotId, snapshotHash };
  });
  const files = [...pinned.files].sort((left, right) => left.fileId < right.fileId ? -1 : 1)
    .map(({ fileId, sha256 }) => ({ fileId, sha256 }));
  if (byStream.size || aggregate.contentHash !== hashCanonical({
    manifestHash: pinned.hash, streams, files, eventIds, evidenceIds,
  })) {
    throw new PreviewFailure(409);
  }
  return capture;
}

function assertCitations(input: PreviewRequest, capture: SnapshotRead): void {
  const required = new Set(input.spec.evidenceRefs);
  for (const profile of input.profiles) {
    for (const table of profile.approvedLookups) {
      for (const entry of table.entries) for (const id of entry.evidenceRefs) required.add(id);
    }
    for (const term of profile.contractTerms) for (const id of term.evidenceRefs) required.add(id);
    for (const finding of profile.findings) for (const id of finding.evidenceRefs) required.add(id);
  }
  const pinned = new Set(capture.snapshot.evidenceIds);
  const resolved = new Map(capture.evidence.map(ref => [ref.id, ref]));
  if (resolved.size !== capture.evidence.length) throw new PreviewFailure(409);
  const files = new Map(capture.manifest.files.map(file => [file.fileId, file.sha256]));
  const snapshots = new Set([capture.snapshot.id, ...capture.manifest.streams.map(stream => stream.snapshotId)]);
  for (const id of required) {
    const ref = resolved.get(id);
    if (!pinned.has(id) || !ref) throw new PreviewFailure(404);
    const originalHash = files.get(ref.sourceId);
    if (originalHash !== undefined) {
      if (ref.snapshotId !== capture.snapshot.id || originalHash !== ref.sha256) throw new PreviewFailure(409);
    } else if (ref.locator.kind !== 'json' || !snapshots.has(ref.snapshotId)) {
      // The source adapter resolves scoped API JSON associations that are not document members.
      throw new PreviewFailure(409);
    }
  }
}

function recordHold(code: string, message: string, events: RawSourceEvent[], profile?: CustomerProfile): Hold {
  const eventIds = events.map(event => event.id).sort();
  const diagnostics: Diagnostic[] = [{ code, message, severity: 'blocker', sourceIds: eventIds, fieldPaths: [] }];
  return { code, eventIds, ...(profile ? { scope: profile.scope } : {}), dependencies: [], diagnostics };
}

function partition(capture: SnapshotRead, profiles: CustomerProfile[]): { batches: Map<string, RawSourceEvent[]>; holds: Hold[] } {
  const sellers = new Set(profiles.map(profile => profile.scope.sellerEntityId));
  const accounts = new Map<string, CustomerProfile>();
  for (const profile of profiles) {
    for (const account of profile.sourceAccountIds) accounts.set(profile.scope.sellerEntityId + '/' + account, profile);
  }
  const batches = new Map<string, RawSourceEvent[]>();
  const holds: Hold[] = [];
  const unscopedSemantic = Object.hasOwn(capture.manifest.semanticVersions, '*') ||
    capture.events.some(event => event.kind === 'semantic_change' &&
      (!event.rawIdentity.sellerEntityId || !event.rawIdentity.sourceAccountId));
  const unknownSeller = capture.events.some(event => !sellers.has(event.rawIdentity.sellerEntityId ?? ''));
  if (unscopedSemantic || unknownSeller) {
    const code = unscopedSemantic ? 'SEMANTIC_VERSION' : 'IDENTITY_SCOPE';
    return { batches, holds: [recordHold(code, 'Unresolved seller or unscoped semantics pauses source preview', capture.events)] };
  }
  for (const event of [...capture.events].sort((left, right) => left.id < right.id ? -1 : 1)) {
    const { sellerEntityId, sourceAccountId } = event.rawIdentity;
    const key = sellerEntityId + '/' + sourceAccountId;
    const profile = sourceAccountId ? accounts.get(key) : undefined;
    if (!profile) {
      holds.push(recordHold('UNKNOWN_ACCOUNT', 'Source account has no approved identity', [event]));
      continue;
    }
    if (!Object.hasOwn(capture.manifest.semanticVersions, key) ||
      capture.manifest.semanticVersions[key] !== profile.semanticVersion) {
      holds.push(recordHold('SEMANTIC_VERSION', 'Pinned account semantic revision is not reviewed', [event], profile));
      continue;
    }
    const batch = batches.get(profile.hash) ?? [];
    batch.push(event);
    batches.set(profile.hash, batch);
  }
  return { batches, holds };
}

function output(
  artifact: PreviewResponse['artifact'], outcome: PlanOutcome, diffs: PreviewResponse['diffs'],
  diagnostics = outcome.holds.flatMap(hold => hold.diagnostics),
): PreviewResponse {
  return PreviewResponseSchema.parse({ artifact, outcome, diffs, unsupportedRows: outcome.holds, diagnostics, parentWrites: 0 });
}

export function createPreviewPlugin(dependencies: PreviewDependencies): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler((error, request, reply) => {
      const status = publicFailure(error);
      const body: ApiError = { ...failures[status], diagnostics: [], correlationId: request.id };
      return reply.header('Cache-Control', 'no-store').code(status).send(body);
    });
    app.post('/api/connectors/preview', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const capability = await dependencies.authorizeRead(request);
      const parsed = PreviewRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new PreviewFailure(400);
      const input = parsed.data;
      if ((capability?.caller !== 'reviewer' && capability?.caller !== 'task') ||
        !IdSchema.array().safeParse(capability.allowedSourceRefs).success ||
        !IdSchema.array().safeParse(capability.allowedAccountIds).success ||
        !capability.allowedSourceRefs.includes(input.spec.sourceRef) ||
        input.profiles.some(profile => !capability.allowedAccountIds.includes(profile.scope.accountId))) {
        throw new PreviewFailure(403);
      }
      let matchingProfileHashes: boolean;
      try {
        matchingProfileHashes = input.profiles.every(profile => hashProfile(profile) === profile.hash);
      } catch {
        throw new PreviewFailure(400);
      }
      if (!matchingProfileHashes) throw new PreviewFailure(409);
      const capture = verifyCapture(await dependencies.readSnapshot(input.snapshotId, capability), input);
      const compiled = compile(input.spec, input.profiles);
      if (!compiled.ok) return output(null, { plans: [], holds: [] }, [], compiled.diagnostics);
      assertCitations(input, capture);

      const { batches, holds } = partition(capture, input.profiles);
      const outcome: PlanOutcome = { plans: [], holds };
      const diffs: PreviewResponse['diffs'] = [];
      const profiles = [...input.profiles].sort((left, right) => left.hash < right.hash ? -1 : 1);
      for (const profile of profiles) {
        const events = batches.get(profile.hash);
        if (!events?.length) continue;
        const target = TargetStateSchema.safeParse(await dependencies.readTarget(profile.scope, input.asOf, capability));
        if (!target.success || !sameScope(target.data.scope, profile.scope)) throw new PreviewFailure(503);
        const beforeBalanceCents = computeBalance(target.data, input.asOf);
        const planned = planBatch(compiled.value, profile, events, { ...target.data, asOf: input.asOf });
        outcome.plans.push(...planned.plans);
        outcome.holds.push(...planned.holds);
        for (const plan of planned.plans) {
          diffs.push({
            scope: plan.scope, beforeVersion: plan.expectedTargetVersion, beforeBalanceCents,
            afterBalanceCents: plan.expectedBalanceCents, operations: plan.operations, lineage: plan.lineage,
          });
        }
      }
      const response = output(compiled.value, outcome, diffs);
      await dependencies.registerCandidate?.({
        spec: input.spec, artifact: compiled.value, profiles, manifest: capture.manifest, snapshot: capture.snapshot,
      });
      return response;
    });
  };
}
