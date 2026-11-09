import { spawn } from 'node:child_process';
import { createReadStream, fstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashCanonical, hashBootstrapVerificationResult, bootstrapRequiredAssertions, bootstrapRequiredCases } from '@eapr/contracts';
import { deriveBootstrapBinding } from '../../src/bootstrap-verify.ts';

async function read(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

if (Object.keys(process.env).some(key => key !== '__CF_USER_TEXT_ENCODING')) process.exit(2);

const input = await read(process.stdin);
if (input.protocolVersion === 'bootstrap-subject-1') {
  try {
    // Node may claim fd 3 for its own internal use. It must not be a launcher pipe.
    const descriptor = fstatSync(3);
    if (descriptor.isSocket()) process.exit(3);
  } catch (error) {
    if (error.code !== 'EBADF') throw error;
  }
  if (Object.keys(input).sort().join() !== 'artifact,events,profile,protocolVersion,requestId,target') process.exit(4);
  const requestId = input.requestId === 'wrong-id' ? 'other-id' : input.requestId;
  const protocolVersion = input.requestId === 'wrong-protocol' ? 'bootstrap-1' : input.protocolVersion;
  process.stdout.write(JSON.stringify({ protocolVersion, requestId, outcome: { plans: [], holds: [] } }) + '\n');
} else {
  if (Object.keys(input).sort().join() !==
    'artifact,events,jobId,manifest,pin,profiles,protocolVersion,selectedProfileHash,snapshot,target') process.exit(6);
  const context = await read(createReadStream('', { fd: 3 }));
  if (context.requestHash !== hashCanonical(input)) process.exit(5);
  const result = {
    schemaVersion: '1', id: 'bootstrap-result:' + input.jobId, jobId: input.jobId, pin: input.pin,
    binding: deriveBootstrapBinding(input), planHash: null, passed: false, createdAt: input.manifest.asOf,
    assertions: bootstrapRequiredAssertions.map(id => ({ id, status: 'unavailable', caseIds: [] })),
    cases: bootstrapRequiredCases.map(id => ({ id, status: 'unavailable' })),
  };
  result.hash = hashBootstrapVerificationResult(result);
  const output = { protocolVersion: 'bootstrap-completion-1', jobId: input.jobId,
    requestHash: context.requestHash, result, observedBaselinePlan: null, observedBaselinePlanBytesHash: null };

  switch (input.jobId) {
    case 'wrong-job': output.jobId = 'another-job'; break;
    case 'wrong-request': output.requestHash = '0'.repeat(64); break;
    case 'wrong-protocol': output.protocolVersion = 'bootstrap-1'; break;
    case 'stderr-limit': process.stderr.write('private-sentinel'.repeat(9000)); break;
    case 'stdout-limit': process.stdout.write('x'.repeat(70_000)); break;
    case 'extra-line': process.stdout.write('\n'); break;
    case 'failed-exit': process.exitCode = 1; break;
    case 'timeout': {
      const marker = join(context.roots.sidecarRoot, 'grandchild-leak');
      spawn(process.execPath, ['-e',
        "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], ''), 1500)", marker,
      ], { env: {}, stdio: 'ignore' });
      writeFileSync(join(context.roots.sidecarRoot, 'grandchild-started'), '');
      await new Promise(resolve => setTimeout(resolve, 5000));
      break;
    }
  }
  process.stderr.write('private-sentinel');
  process.stdout.write(JSON.stringify(input.jobId === 'result-only' ? result : output) + '\n');
}
