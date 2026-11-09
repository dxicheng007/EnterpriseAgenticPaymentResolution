import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import { BootstrapSubjectInputV1Schema, BootstrapSubjectOutputV1Schema, readBootstrapMessage } from './bootstrap-protocol.js';

try {
  const { protocolVersion, requestId, artifact, profile, events, target } =
    BootstrapSubjectInputV1Schema.parse(await readBootstrapMessage(process.stdin));
  const outcome = planBootstrap(artifact, profile, events, target);
  process.stdout.write(JSON.stringify(BootstrapSubjectOutputV1Schema.parse({ protocolVersion, requestId, outcome })) + '\n');
} catch {
  process.exitCode = 1;
}
