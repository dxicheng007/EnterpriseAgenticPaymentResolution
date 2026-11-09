import { ApiErrorSchema, IdSchema, type Id, type SemanticPreflight } from '@eapr/contracts';
import { SourceError } from '@eapr/sources';
import type { FastifyPluginAsync } from 'fastify';
import type { ControlServices } from '../server.js';

function invalidRequest() {
  return new SourceError(400,'SOURCE_METADATA_INVALID','Source request is invalid');
}

export function sourceSemanticsPlugin(
  authorizeBearer: (authorization: string | undefined) => void,
  authorizeSource: (sourceRef: Id) => void,
  readCurrentSemantics: (sourceRef: Id) => Promise<SemanticPreflight>,
): FastifyPluginAsync<ControlServices> {
  return async app=>{
    app.setErrorHandler((error,request,reply)=>{
      const mapped = error instanceof SourceError ? error
        : new SourceError(503,'SOURCE_SEMANTICS_UNAVAILABLE','Current source semantics could not be verified');
      return reply.code(mapped.status).header('Cache-Control','no-store').send(ApiErrorSchema.parse({
        code:mapped.code,message:mapped.message,diagnostics:mapped.diagnostics,correlationId:request.id,
      }));
    });
    app.get<{Params:{sourceRef:string}}>('/internal/sources/:sourceRef/semantics',{
      exposeHeadRoute:false,
      onRequest:async (request,reply)=>{
        reply.header('Cache-Control','no-store');
        authorizeBearer(request.headers.authorization);
        if (!IdSchema.safeParse(request.params.sourceRef).success) throw invalidRequest();
        authorizeSource(request.params.sourceRef);
        const length = request.headers['content-length'];
        if (request.raw.url?.includes('?') ||
            request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
          throw invalidRequest();
        }
      },
    },request=>readCurrentSemantics(request.params.sourceRef));
  };
}
