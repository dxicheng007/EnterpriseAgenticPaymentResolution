import { discoveryReadToolSchemas } from '../../contracts/src/index.js';
import {
  discoveryCompileToolSchemas, discoveryFindingToolSchemas, discoveryProposalToolSchemas,
} from '../../contracts/src/discovery-construction-tools.js';
import type { TaskRow } from './repository.js';
import { delegateTaskTool } from './tasks.js';

const common = new Set([
  'describeSource', 'querySnapshot', 'searchEvidence', 'readEvidence', 'publishFinding', 'readFinding', 'requestInvestigation',
]);
const coordinator = new Set(['delegateTask', 'beginRepair', 'finishRun']);
const connector = new Set([
  'draftConnector', 'reviseConnector', 'compileConnector', 'runSandboxReplay', 'compareArtifacts', 'requestVerification', 'readVerification',
]);

export function toolSchemas(role: TaskRow['role'], reads = false, compile = false) {
  return [
    ...(role === 'coordinator' ? [delegateTaskTool] : []),
    ...(reads ? [...discoveryReadToolSchemas, ...discoveryFindingToolSchemas] : []),
    ...(reads && role === 'connector' ? discoveryProposalToolSchemas : []),
    ...(reads && compile && role === 'connector' ? discoveryCompileToolSchemas : []),
  ];
}

export function unavailableToolCode(role: TaskRow['role'], name: string) {
  const recognized = common.has(name) || (role === 'coordinator' && coordinator.has(name)) ||
    (role === 'connector' && connector.has(name));
  return recognized ? 'TOOL_UNAVAILABLE' : 'TOOL_FORBIDDEN';
}
