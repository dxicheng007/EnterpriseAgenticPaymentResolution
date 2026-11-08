import multipart from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  ApiErrorSchema, IdSchema, UploadMetadataSchema, UploadResponseSchema, type Id, type UploadMetadata,
} from '@eapr/contracts';
import type { EvidenceStore } from '@eapr/evidence';
import {
  MAX_METADATA_BYTES, MAX_UPLOAD_BYTES, readDossier, readEvidence, readEvidenceBytes,
  SourceError, uploadSource, type UploadDependencies,
} from '@eapr/sources';

type Authorization = {companyId:Id; sourceRef:Id; operation:'read'|'upload'|'operator'};
export type AuthorizeSource = (request: FastifyRequest, access: Authorization) => Promise<void>;

type SourcePluginOptions = {
  catalog: ReadonlyMap<Id, {companyId:Id; sourceRef:Id}>;
  authorizeSource: AuthorizeSource;
  store: EvidenceStore;

};

function id(value: string, code: string) {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) throw new SourceError(404,code,'Requested source member was not found');
  return parsed.data;
}

async function readUpload(request: FastifyRequest) {
  if (!request.isMultipart()) throw new SourceError(400,'SOURCE_METADATA_INVALID','Multipart upload is required');
  let metadata: UploadMetadata | undefined;
  let file: Buffer | undefined;
  for await (const part of request.parts()) {
    if (part.type !== 'file') throw new SourceError(400,'SOURCE_METADATA_INVALID','Unexpected upload field');
    if (part.fieldname === 'metadata' && part.filename === undefined && !metadata) {
      // Busboy streams metadata bytes to preserve invalid UTF-8 and byte limits
      // before Fastify can decode and automatically parse a JSON field.
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of part.file) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.byteLength;
        if (length <= MAX_METADATA_BYTES) chunks.push(bytes);
      }
      if (part.file.truncated || length > MAX_METADATA_BYTES) {
        throw new SourceError(413,'SOURCE_UPLOAD_LIMIT','Upload metadata is too large');
      }
      try {
        const json = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
        metadata = UploadMetadataSchema.parse(JSON.parse(json));
      } catch {
        throw new SourceError(400,'SOURCE_METADATA_INVALID','Upload metadata is invalid');
      }
    } else if (part.fieldname === 'file' && !file) {
      file = await part.toBuffer();
      if (part.file.truncated || file.byteLength > MAX_UPLOAD_BYTES) {
        throw new SourceError(413,'SOURCE_UPLOAD_LIMIT','Upload file is too large');
      }
    } else {
      part.file.resume();
      throw new SourceError(400,'SOURCE_METADATA_INVALID','Exactly one metadata field and one file part are required');
    }
  }
  if (!file || !metadata) throw new SourceError(400,'SOURCE_METADATA_INVALID','Metadata and file are required');
  return {file,metadata};
}

export function createSourcePlugin({catalog,authorizeSource,store}:SourcePluginOptions):
  FastifyPluginAsync<Omit<UploadDependencies,'store'>> {
  if (typeof authorizeSource !== 'function') throw new Error('Source authorization is required');
  return async function sourcePlugin(app,{db,clock}) {
    await app.register(multipart,{
      limits:{fileSize:MAX_UPLOAD_BYTES+1,fieldSize:MAX_METADATA_BYTES+1,files:3,fields:2,parts:3},
      isPartAFile:(field,contentType,filename) =>
        field === 'metadata' || contentType === 'application/octet-stream' || filename !== undefined,
    });
    app.setErrorHandler((error,request,reply) => {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      const mapped = error instanceof SourceError ? error
        : code === 'FST_REQ_FILE_TOO_LARGE' ? new SourceError(413,'SOURCE_UPLOAD_LIMIT','Upload file is too large')
        : typeof code === 'string' && code.startsWith('FST_') ?
          new SourceError(400,'SOURCE_METADATA_INVALID','Source request is invalid')
        : new SourceError(503,'SOURCE_UNAVAILABLE','Source service is unavailable');
      return reply.code(mapped.status).header('Cache-Control','no-store').send(ApiErrorSchema.parse({
        code:mapped.code,message:mapped.message,diagnostics:mapped.diagnostics,correlationId:request.id,
      }));
    });
    app.post('/api/sources/uploads',async (request,reply) => {
      const {file,metadata} = await readUpload(request);
      await authorizeSource(request,{companyId:metadata.companyId,sourceRef:metadata.sourceRef,operation:'upload'});
      if (catalog.get(metadata.companyId)?.sourceRef !== metadata.sourceRef) {
        throw new SourceError(404,'SOURCE_NOT_FOUND','Source was not found');
      }
      const response = UploadResponseSchema.parse(await uploadSource({db,clock,store},metadata,file));
      return reply.code(response.duplicate ? 200 : 201).header('Cache-Control','no-store').send(response);
    });
    app.get<{Params:{companyId:string}; Querystring:{manifestId?:string}}>('/api/sources/:companyId/dossier',
      async (request,reply) => {
        const companyId = id(request.params.companyId,'MANIFEST_NOT_FOUND');
        const source = catalog.get(companyId);
        if (!source) throw new SourceError(404,'MANIFEST_NOT_FOUND','Manifest was not found');
        await authorizeSource(request,{...source,operation:'read'});
        const manifestId = request.query.manifestId === undefined ? undefined : id(request.query.manifestId,'MANIFEST_NOT_FOUND');
        return reply.header('Cache-Control','no-store').send(await readDossier(db,companyId,manifestId));
      },
    );
    app.get<{Params:{id:string}}>('/api/evidence/:id',async (request,reply) => {
      const result = await readEvidence(db,id(request.params.id,'EVIDENCE_NOT_FOUND'),
        ({companyId,sourceRef}) => authorizeSource(request,{companyId,sourceRef,operation:'read'}));
      return reply.header('Cache-Control','no-store').send(result);
    });
    app.get<{Params:{id:string}}>('/api/evidence/:id/content',async (request,reply) => {
      const {bytes,mediaType} = await readEvidenceBytes(db,store,id(request.params.id,'EVIDENCE_NOT_FOUND'),
        ({companyId,sourceRef}) => authorizeSource(request,{companyId,sourceRef,operation:'read'}));
      return reply.type(mediaType).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').send(bytes);
    });
  };
}
