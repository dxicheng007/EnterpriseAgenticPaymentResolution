import { timingSafeEqual } from 'node:crypto';
import { IdSchema, type Id, type SemanticPreflight } from '@eapr/contracts';
import { readCurrentSemantics, SourceError, type SourceDefinition } from '@eapr/sources';
import type { Pool } from 'pg';
import type { Clock } from '../../../packages/storage/src/control-db.js';
import { sourceSemanticsPlugin } from './routes/source-semantics.js';

const bearerPrefix = 'Bearer ';
const maxTokenLength = 1024;

function forbidden() {
  return new SourceError(403,'SOURCE_FORBIDDEN','Source semantics access is forbidden');
}

export function composeSourceSemantics(
  dependencies: {db:Pool;clock:Clock},
  options: {catalog:ReadonlyMap<Id,SourceDefinition>;capability:{token:string;sourceRefs:readonly Id[]}},
) {
  const {catalog,capability} = options;
  if (!capability || typeof capability.token !== 'string' || capability.token.length > maxTokenLength ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(capability.token) || !Array.isArray(capability.sourceRefs) ||
      !capability.sourceRefs.length || !IdSchema.array().safeParse(capability.sourceRefs).success) {
    throw new Error('Source semantics requires a valid read capability');
  }
  const allowed = new Set(capability.sourceRefs);
  if (allowed.size !== capability.sourceRefs.length) throw new Error('Source semantics allowlist contains duplicate IDs');
  const expected = Buffer.from(capability.token);

  function authorizeBearer(authorization: string | undefined) {
    if (authorization?.length !== bearerPrefix.length + expected.length ||
        authorization.slice(0,bearerPrefix.length).toLowerCase() !== bearerPrefix.toLowerCase()) throw forbidden();
    const supplied = Buffer.from(authorization.slice(bearerPrefix.length));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) throw forbidden();
  }

  function authorizeSource(sourceRef:Id) {
    if (!allowed.has(sourceRef)) throw forbidden();
  }

  async function observe(sourceRef:Id):Promise<SemanticPreflight> {
    authorizeSource(sourceRef);
    return readCurrentSemantics(dependencies,catalog,sourceRef);
  }

  return {plugin:sourceSemanticsPlugin(authorizeBearer,authorizeSource,observe),readCurrentSemantics:observe};
}
