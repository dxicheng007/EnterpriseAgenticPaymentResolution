import type { Pool, PoolClient } from 'pg';
import {
  UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical, type Hash, type Id, type UploadMetadata, type UploadResponse,
} from '@eapr/contracts';
import { extractDocument, SourceContentError, type EvidenceStore, type Extraction } from '@eapr/evidence';
import { publishActivity } from '@eapr/storage/activity';
import { withTransaction } from '@eapr/storage/transaction';
import type { Clock } from '@eapr/storage/control-db';
import { SourceError } from './errors.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_METADATA_BYTES = 16 * 1024;

export type StoredSourceFile = {
  file_id:Id;
  content_hash:Hash;
  byte_length:number;
  metadata:UploadMetadata;
  extraction:Extraction;
  extraction_hash:Hash;
};
export type UploadDependencies = {db:Pool; store:EvidenceStore; clock:Clock};

export function sourceFileId({companyId,sourceRef,documentId,documentVersion}: UploadMetadata): Id {
  return 'file:' + hashCanonical({companyId,sourceRef,documentId,documentVersion});
}

export async function lockSource(client: PoolClient, sourceRef: Id) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',['acquisition:' + sourceRef]);
}

export async function storeSourceUpload(
  {db,store,clock}:UploadDependencies, input:UploadMetadata, bytes:Uint8Array,
) {
  const validated = UploadMetadataSchema.safeParse(input);
  if (!validated.success) throw new SourceError(400,'SOURCE_METADATA_INVALID','Upload metadata is invalid');
  const metadata = validated.data;
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new SourceError(413,'SOURCE_UPLOAD_LIMIT','Upload file is too large');
  const {batch,companyId,sourceRef,documentId,documentVersion} = metadata;
  const fileId = sourceFileId(metadata);
  const originalHash = hashBytes(bytes);
  async function findExisting(query:Pick<Pool,'query'>) {
    const match = await query.query<StoredSourceFile>(
      'SELECT * FROM source_files WHERE file_id = $1 OR ' +
      '(source_ref = $2 AND batch_stream_id = $3 AND (batch_id = $4 OR batch_sequence = $5))',
      [fileId,sourceRef,batch?.streamId ?? null,batch?.batchId ?? null,batch?.sequence ?? null],
    );
    const current = match.rows[0];
    if (current && (match.rows.length !== 1 || current.file_id !== fileId || current.content_hash !== originalHash ||
        canonicalJson(current.metadata) !== canonicalJson(metadata))) {
      throw new SourceError(409,'SOURCE_HASH_CONFLICT','An immutable document version or batch conflicts');
    }
    return current;
  }
  await findExisting(db);
  let extraction: Extraction;
  try {
    extraction = await extractDocument(metadata.kind,bytes);
  } catch (error) {
    if (error instanceof SourceContentError) throw new SourceError(422,error.message,'Upload content is invalid or unsupported');
    throw error;
  }
  let contentHash: Hash;
  try {
    contentHash = await store.put(bytes);
  } catch {
    throw new SourceError(503,'SOURCE_UNAVAILABLE','Original byte storage is unavailable');
  }
  return withTransaction(db,async client => {
    await lockSource(client,sourceRef);
    const current = await findExisting(client);
    if (current) return {file:current, duplicate:true};
    const result = await client.query<StoredSourceFile>(
      'INSERT INTO source_files (file_id,company_id,source_ref,document_id,document_version,content_hash,byte_length,' +
      'metadata,extraction,extraction_hash,batch_id,batch_sequence,batch_stream_id) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [fileId,companyId,sourceRef,documentId,documentVersion,contentHash,bytes.byteLength,
        JSON.stringify(metadata),JSON.stringify(extraction),hashCanonical(extraction),
        batch?.batchId ?? null,batch?.sequence ?? null,batch?.streamId ?? null],
    );
    await publishActivity(client,{
      stream:'control',phase:'build',type:'source.captured',at:clock().toISOString(),payload:{sourceId:fileId,sourceRef},
    });
    return {file:result.rows[0]!, duplicate:false};
  });
}

export async function uploadSource(
  dependencies:UploadDependencies,metadata:UploadMetadata,bytes:Uint8Array,
):Promise<UploadResponse> {
  const {file,duplicate} = await storeSourceUpload(dependencies,metadata,bytes);
  return {fileId:file.file_id,documentId:metadata.documentId,documentVersion:metadata.documentVersion,
    contentHash:file.content_hash,duplicate,evidenceIds:[],diagnostics:[]};
}
