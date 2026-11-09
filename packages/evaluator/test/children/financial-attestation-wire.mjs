import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { hashCanonical } from '@eapr/contracts';

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks));
}

const [request, context] = await Promise.all([read(process.stdin), read(createReadStream('', { fd: 3 }))]);
if (Object.keys(process.env).some(key => key !== '__CF_USER_TEXT_ENCODING') ||
  'roots' in request || context.requestHash !== hashCanonical(request)) process.exit(2);

const output = {
  protocolVersion: 'financial-attestation-probe-result-1',
  requestHash: context.requestHash, jobId: request.jobId, evaluatorBuildHash: request.evaluatorBuildHash,
  evidencePin: { fixtureSetId: request.selection.fixtureSetId, fixtureSetVersion: '2', bundleHash: '1'.repeat(64) },
  capture: { companyId: 'company', sourceRef: 'source', manifestId: 'manifest', manifestHash: '1'.repeat(64),
    snapshotId: 'snapshot:manifest', snapshotHash: '1'.repeat(64), snapshotObjectHash: '1'.repeat(64), eventsHash: '1'.repeat(64) },
};
switch (request.jobId) {
  case 'wrong-job': output.jobId = 'another-job'; break;
  case 'wrong-request': output.requestHash = '0'.repeat(64); break;
  case 'invalid-utf8': process.stdout.write(Buffer.from([0xff])); break;
  case 'stderr-limit': process.stderr.write('private'.repeat(3000)); break;
  case 'stdout-limit': process.stdout.write('x'.repeat(20000)); break;
  case 'aggregate-limit': process.stderr.write('x'.repeat(10000)); process.stdout.write('y'.repeat(10000)); break;
  case 'extra-line': process.stdout.write('\n'); break;
  case 'failed-exit': process.exitCode = 1; break;
  case 'no-newline': process.stdout.write(JSON.stringify(output)); process.exit(0); break;
  case 'timeout': {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100)'], { stdio: 'inherit' });
    writeFileSync(join(context.roots.servedRoots[0], 'descendant.pid'), String(descendant.pid));
    setInterval(() => {}, 100);
    break;
  }
}
process.stdout.write(JSON.stringify(output) + '\n');
