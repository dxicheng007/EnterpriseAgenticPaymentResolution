import { planBatch } from '@eapr/compiler/plan-batch';
import { SubjectInputSchema, SubjectOutputSchema } from './protocol.js';

try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const { requestId, artifact, profile, events, target } = SubjectInputSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
  );
  const outcome = planBatch(artifact, profile, events, target);
  process.stdout.write(JSON.stringify(SubjectOutputSchema.parse({ requestId, outcome })) + '\n');
} catch {
  process.exitCode = 1;
}
