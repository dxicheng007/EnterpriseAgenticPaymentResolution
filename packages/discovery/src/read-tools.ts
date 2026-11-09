import {
  DescribeSourceResultSchema, QuerySnapshotResultSchema, ReadEvidenceResultSchema, SearchEvidenceResultSchema,
  type DiscoveryReadToolFailure, type DiscoveryReadToolName, type DiscoveryReadToolResult,
} from '../../contracts/src/index.js';
import type { DiscoveryReadTools, PreparedDiscoveryRead } from '../../sources/src/discovery-tools.js';
import { SourceError } from '../../sources/src/errors.js';

export type { DiscoveryReadTools };

const resultSchemas = {
  describeSource: DescribeSourceResultSchema,
  querySnapshot: QuerySnapshotResultSchema,
  searchEvidence: SearchEvidenceResultSchema,
  readEvidence: ReadEvidenceResultSchema,
};

export function parseReadResult(name: DiscoveryReadToolName, result: unknown): DiscoveryReadToolResult | undefined {
  const parsed = resultSchemas[name].safeParse(result);
  return parsed.success ? parsed.data : undefined;
}

export function captureFailure(error: unknown): DiscoveryReadToolFailure['code'] {
  if (!(error instanceof SourceError)) return 'SOURCE_UNAVAILABLE';
  switch (error.code) {
    case 'SOURCE_FORBIDDEN': return 'DISCOVERY_FORBIDDEN';
    case 'SOURCE_CONTENT_INVALID': return error.status === 400 ? 'DISCOVERY_INVALID' : 'DISCOVERY_CONFLICT';
    case 'SOURCE_NOT_FOUND':
    case 'SOURCE_EPOCH_CONFLICT':
    case 'SOURCE_HASH_CONFLICT':
    case 'MANIFEST_MEMBER_MISSING':
    case 'CITATION_INVALID': return 'DISCOVERY_CONFLICT';
    default: return 'SOURCE_UNAVAILABLE';
  }
}

export async function prepareRead(
  tools: DiscoveryReadTools,
  input: Parameters<DiscoveryReadTools['prepare']>[0],
): Promise<PreparedDiscoveryRead | { result: DiscoveryReadToolFailure }> {
  try {
    return await tools.prepare(input);
  } catch (error) {
    return { result: { ok: false, code: captureFailure(error) } };
  }
}
