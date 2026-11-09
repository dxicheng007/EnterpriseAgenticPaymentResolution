import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { CandidateRegistry, PreviewReadContext, SnapshotRead, SnapshotReader, TargetReader } from '@eapr/compiler/preview-adapters';
import { DemoCandidatesResponseSchema, TargetStateSchema, type DemoCandidatesResponse, type Id } from '@eapr/contracts';
import { sameScope } from '@eapr/finance/validate';
import {
  companyA, companyB, createSourceService, readDossier, readEvidence, readManifest,
  SourceError, type EvidenceAuthorization, type SourceDefinition, type UploadDependencies,
} from '@eapr/sources';
import { composeDiscovery } from './discovery-composition.js';
import { buildDemoCandidate, type DemoCapture } from './demo-candidates.js';
import { createLocalSessionService, LocalSessionError } from './local-session.js';
import { createPreviewPlugin } from './routes/preview.js';
import { createSourcePlugin, type AuthorizeSource } from './routes/sources.js';
import {
  composeVerification, verificationSetupDiagnostic, type CaptureBinding, type LocalVerificationOptions,
  type VerificationSetupCode,
} from './verification-composition.js';

export const localSourceCatalog: ReadonlyMap<Id, SourceDefinition> = new Map(
  [companyA, companyB].map(source => [source.companyId, source]),
);

export async function createLocalComposition(dependencies: UploadDependencies, options: {
  webOrigin: string;
  captures: DemoCapture[];
  registry?: Pick<CandidateRegistry, 'registerCandidate'>;
  verification?: LocalVerificationOptions;
  verificationSetupDiagnostic?: VerificationSetupCode;
}) {
  const { db, store } = dependencies;
  const service = createSourceService(dependencies, localSourceCatalog);
  const captureIds = new Map<Id, DemoCapture>();
  const captureBindings: CaptureBinding[] = [];
  const companies = new Set<Id>();
  const catalog: DemoCandidatesResponse = {
    mode: 'development-fixture', targetMode: 'empty-fixture', verificationAvailable: false, candidates: [], diagnostics: [],
  };

  const sourceBoundary = (companyId: Id, sourceRef: Id): EvidenceAuthorization =>
    async binding => {
      if (binding.companyId !== companyId || binding.sourceRef !== sourceRef) throw new LocalSessionError(403);
    };

  for (const capture of options.captures) {
    const source = localSourceCatalog.get(capture.companyId);
    const snapshotId = 'snapshot:' + capture.manifestId;
    if (!source || captureIds.has(snapshotId) || companies.has(source.companyId)) throw new Error('Local demo capture configuration conflicts');
    const snapshot = await service.getSnapshot(snapshotId);
    const manifest = await readManifest(db, source.companyId, snapshot.manifestId);
    const dossier = await readDossier(db, source.companyId, manifest.id);
    if (!dossier.complete || !dossier.snapshotIds.includes(snapshot.id) || snapshot.sourceRef !== source.sourceRef) {
      throw new Error('Local demo source capture is unavailable');
    }
    captureIds.set(snapshot.id, capture);
    companies.add(source.companyId);
    captureBindings.push({
      companyId: source.companyId, sourceRef: source.sourceRef, manifestId: manifest.id,
      manifestHash: manifest.hash, snapshotHash: snapshot.contentHash,
    });
    const authorize = sourceBoundary(source.companyId, source.sourceRef);
    const records = await service.getSnapshotRecords(snapshot.id);
    const evidence = await Promise.all(snapshot.evidenceIds.map(id => readEvidence(db, id, authorize)));
    const matching = evidence.filter(({ evidence: ref }) => ref.sourceId === capture.contractFileId &&
      ref.locator.kind === 'pdf' && ref.locator.page === 1);
    const result = buildDemoCandidate({
      source, capture, manifest, snapshot, events: records, citation: matching.length === 1 ? matching[0] : undefined,
    });
    if ('candidate' in result) catalog.candidates.push(result.candidate);
    else catalog.diagnostics.push(result.diagnostic);
  }

  const reviewer = {
    reviewerId: 'demo-reviewer',
    allowedSourceRefs: [...localSourceCatalog.values()].map(source => source.sourceRef),
    allowedAccountIds: catalog.candidates.map(candidate => candidate.scope.accountId),
  };
  const session = createLocalSessionService({ webOrigin: options.webOrigin, ...reviewer });

  const authorizeSource: AuthorizeSource = async (request, { companyId, sourceRef, operation }) => {
    try {
      if (operation === 'operator') throw new LocalSessionError(403);
      const caller = await session.authorizeReviewer(request, { mutation: operation === 'upload' });
      // The reviewer inspects a source-wide dossier. Candidate account grants are narrower preview capabilities.
      if (localSourceCatalog.get(companyId)?.sourceRef !== sourceRef || !caller.allowedSourceRefs.includes(sourceRef)) {
        throw new LocalSessionError(403);
      }
    } catch (error) {
      if (error instanceof LocalSessionError) throw new SourceError(error.statusCode, error.code, error.message);
      throw error;
    }
  };

  async function authorizeRead(request: FastifyRequest): Promise<PreviewReadContext> {
    const { allowedSourceRefs, allowedAccountIds } = await session.authorizeReviewer(request, { mutation: true });
    return { caller: 'reviewer', allowedSourceRefs, allowedAccountIds };
  }

  const readSnapshot: SnapshotReader['readSnapshot'] = async (snapshotId, capability): Promise<SnapshotRead> => {
    try {
      const capture = captureIds.get(snapshotId);
      if (!capture) throw new SourceError(404, 'SNAPSHOT_NOT_FOUND', 'Source snapshot was not found');
      const candidate = catalog.candidates.find(entry => entry.snapshotId === snapshotId);
      if (!candidate || !capability.allowedSourceRefs.includes(candidate.sourceRef) ||
        !capability.allowedAccountIds.includes(candidate.scope.accountId)) throw new LocalSessionError(403);
      const snapshot = await service.getSnapshot(snapshotId);
      const manifest = await readManifest(db, capture.companyId, snapshot.manifestId);
      if (manifest.sourceRef !== candidate.sourceRef || snapshot.sourceRef !== candidate.sourceRef) throw new LocalSessionError(403);
      const [events, dossier, evidence] = await Promise.all([
        service.getSnapshotRecords(snapshot.id),
        readDossier(db, capture.companyId, manifest.id),
        Promise.all(snapshot.evidenceIds.map(async id =>
          (await readEvidence(db, id, sourceBoundary(capture.companyId, manifest.sourceRef))).evidence)),
      ]);
      return { snapshot, manifest, events, dossier, evidence };
    } catch (error) {
      // SourceError uses status, while the accepted preview plugin expects statusCode.
      if (error instanceof SourceError) throw Object.assign(error, { statusCode: error.status });
      throw error;
    }
  };

  const readTarget: TargetReader['readTarget'] = async (scope, asOf, capability) => {
    const candidate = catalog.candidates.find(entry => sameScope(scope, entry.scope));
    if (!candidate || !capability.allowedAccountIds.includes(scope.accountId) ||
      !capability.allowedSourceRefs.includes(candidate.sourceRef)) throw new LocalSessionError(403);
    return TargetStateSchema.parse({
      scope, asOf, version: 0, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
      customers: [], accounts: [], billingConfigurations: [],
    });
  };

  let verification;
  let setupCode = options.verificationSetupDiagnostic;
  if (options.verification && !setupCode) {
    try {
      if (companies.size !== localSourceCatalog.size) throw new Error('Local verification captures are incomplete');
      verification = await composeVerification(
        { dependencies, catalog: localSourceCatalog, service }, options.verification, captureBindings, session.authorizeReviewer,
      );
      catalog.verificationAvailable = true;
    } catch {
      setupCode = 'VERIFICATION_FIXTURE_CONFLICT';
    }
  }
  if (setupCode) catalog.diagnostics.push(verificationSetupDiagnostic(setupCode));
  const registry = verification?.registry ?? options.registry;

  const candidatePlugin: FastifyPluginAsync = async app => {
    app.get('/api/demo/candidates', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        await session.authorizeReviewer(request, { mutation: false });
        return DemoCandidatesResponseSchema.parse(catalog);
      } catch (error) {
        if (!(error instanceof LocalSessionError)) throw error;
        return reply.code(error.statusCode).send({
          code: error.code, message: error.message, correlationId: request.id, diagnostics: [],
        });
      }
    });
  };

  return {
    authorizeReviewer: session.authorizeReviewer,
    authorizeSource,
    featurePlugins: [
      session.plugin,
      composeDiscovery({ catalog: localSourceCatalog, store, reviewer, authorizeReviewer: session.authorizeReviewer }),
      createSourcePlugin({ catalog: localSourceCatalog, authorizeSource, store }),
      createPreviewPlugin({
        authorizeRead, readSnapshot, readTarget,
        registerCandidate: registry?.registerCandidate.bind(registry),
      }),
      candidatePlugin,
      ...(verification ? [verification.plugin] : []),
    ],
  };
}
