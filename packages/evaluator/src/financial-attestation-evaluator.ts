import { constants, createReadStream } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidencePinV1Schema, hashCanonical } from '@eapr/contracts';
import { decodeProtectedEvidenceBundle } from './evidence-fixtures.js';
import { readFinancialBuildHash } from './financial-attestation-build.js';
import { FinancialContextSchema, FinancialRequestSchema, type FinancialContext } from './financial-attestation-protocol.js';
import { financialMessageLimit, readFinancialMessage } from './financial-attestation-runner.js';
import { bindFinancialRequest, financialEqual, validateFinancialCompletion } from './financial-attestation-verify.js';
import { evaluateFinancialSubject } from './financial-evaluate.js';

const checkout = fileURLToPath(new URL('../../../', import.meta.url));
const servedDefaults = ['.local/demo/visible', '.local/demo/evidence', '.local/artifacts', 'apps/web', 'fixtures/visible'];

function contains(root: string, path: string) {
  const difference = relative(root, path);
  return !isAbsolute(difference) && difference !== '..' && !difference.startsWith('..' + sep);
}

// Served roots can be configured before they exist. Resolve symlinks in their existing ancestors.
async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || dirname(path) === path) throw error;
    return join(await physicalPath(dirname(path)), basename(path));
  }
}

async function readEvidencePin(roots: FinancialContext['roots'], fixtureSetId: string) {
  const { evidencePinRoot: root } = roots;
  const served = [...servedDefaults.map(path => join(checkout, path)), ...roots.servedRoots];
  if (!isAbsolute(root) || root !== await realpath(root) || served.some(path => !isAbsolute(path))) throw new Error();
  for (const path of await Promise.all(served.map(physicalPath))) {
    if (contains(path, root) || contains(root, path)) throw new Error();
  }
  const directory = await lstat(root);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o777) !== 0o700) throw new Error();

  const file = await open(join(root, hashCanonical([fixtureSetId, '2']) + '.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o400 ||
      stat.size > financialMessageLimit) throw new Error();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
  } finally {
    await file.close();
  }
}

try {
  const [rawRequest, rawContext] = await Promise.all([
    readFinancialMessage(process.stdin), readFinancialMessage(createReadStream('', { fd: 3 })),
  ]);
  const request = FinancialRequestSchema.parse(rawRequest);
  const context = FinancialContextSchema.parse(rawContext);
  const requestHash = hashCanonical(request);
  if (context.requestHash !== requestHash) throw new Error();
  const capture = bindFinancialRequest(request);
  const { artifact, profiles, manifest, snapshot, events } = request.capture;
  const probe = request.protocolVersion === 'financial-attestation-probe-1';
  const evaluatorBuildHash = probe ? request.evaluatorBuildHash : request.reservation.evaluatorBuildHash;
  const fixtureSetId = probe ? request.selection.fixtureSetId : request.reservation.evidencePin.fixtureSetId;
  if (await readFinancialBuildHash() !== evaluatorBuildHash) throw new Error();

  const bytes = await readEvidencePin(context.roots, fixtureSetId);
  const fixture = await decodeProtectedEvidenceBundle(bytes, manifest);
  const evidencePin = EvidencePinV1Schema.parse({ fixtureSetId, fixtureSetVersion: '2', bundleHash: JSON.parse(bytes).bundleHash });
  if (fixture.truth.fixtureSetId !== fixtureSetId || fixture.truth.fixtureSetVersion !== '2' ||
    fixture.truth.purpose !== 'construction' || !financialEqual(fixture.snapshot, snapshot) ||
    !financialEqual([...fixture.events].sort((a, b) => a.id < b.id ? -1 : 1), events)) throw new Error();

  const binding = { jobId: request.jobId, requestHash, evidencePin, capture, evaluatorBuildHash };
  let result;
  if (probe) {
    result = { protocolVersion: 'financial-attestation-probe-result-1', ...binding };
  } else {
    if (!financialEqual(request.reservation.evidencePin, evidencePin)) throw new Error();
    const report = await evaluateFinancialSubject({
      protocolVersion: 1, jobId: request.jobId, artifact, profiles, manifest, evaluatorBuildHash,
      fixtureSetId, fixtureSetVersion: evidencePin.fixtureSetVersion,
    }, fixture, true);
    result = validateFinancialCompletion(request, {
      protocolVersion: 'financial-attestation-completion-1', ...binding, reservationHash: request.reservation.hash, report,
    }).completion;
  }
  // Equality with already decoded and validated bytes also revalidates the full bundle digest.
  if (await readEvidencePin(context.roots, fixtureSetId) !== bytes ||
    await readFinancialBuildHash() !== evaluatorBuildHash) throw new Error();
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.exitCode = 1;
}
