import { evaluateFinancialSubject } from './financial-evaluate.js';
import { readProtectedFixture } from './fixture-store.js';
import { EvaluatorInputSchema } from './protocol.js';
import { evaluatorBuildHash } from './launcher.js';

try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = EvaluatorInputSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
  );
  if (input.evaluatorBuildHash !== await evaluatorBuildHash()) throw new Error('Evaluator build mismatch');
  const fixture = await readProtectedFixture(input.fixtureSetId, input.fixtureSetVersion, input.manifest);
  process.stdout.write(JSON.stringify(await evaluateFinancialSubject(input, fixture)) + '\n');
} catch {
  process.exitCode = 1;
}
