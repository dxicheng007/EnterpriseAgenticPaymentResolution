import { IdSchema, type Id } from '../../contracts/src/common.js';
import {
  EvidenceResponseSchema, UploadMetadataSchema, UploadResponseSchema,
  type EvidenceResponse, type UploadMetadata, type UploadResponse,
} from '../../contracts/src/evidence.js';
import { SourceDossierSchema, type SourceDossier } from '../../contracts/src/source.js';
import { LocalApiError, requestLocal } from './http.js';

export async function getDossier(companyId: Id, manifestId?: Id, signal?: AbortSignal): Promise<SourceDossier> {
  const company = encodeURIComponent(IdSchema.parse(companyId));
  const query = manifestId === undefined ? '' : '?manifestId=' + encodeURIComponent(IdSchema.parse(manifestId));
  const dossier = await requestLocal('/api/sources/' + company + '/dossier' + query, SourceDossierSchema, { signal });
  if (dossier.companyId !== companyId || (manifestId !== undefined && dossier.manifestId !== manifestId)) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The dossier did not match the selected scope.');
  }
  return dossier;
}

export async function getEvidence(id: Id, signal?: AbortSignal): Promise<EvidenceResponse> {
  const result = await requestLocal('/api/evidence/' + encodeURIComponent(IdSchema.parse(id)),
    EvidenceResponseSchema, { signal });
  if (result.evidence.id !== id) {
    throw new LocalApiError(200, 'MALFORMED_RESPONSE', 'The evidence did not match the selected citation.');
  }
  return result;
}

export async function uploadSource(metadata: UploadMetadata, file: File, signal?: AbortSignal): Promise<UploadResponse> {
  const parsed = UploadMetadataSchema.safeParse({ ...metadata, originalName: file.name });
  if (!parsed.success || !file.size) {
    throw new LocalApiError(422, 'INVALID_UPLOAD', 'Select a nonempty file and enter valid document and batch details.');
  }
  const metadataText = JSON.stringify(parsed.data);
  if (file.size > 10 * 1024 * 1024 || new TextEncoder().encode(metadataText).byteLength > 16 * 1024) {
    throw new LocalApiError(413, 'UPLOAD_TOO_LARGE', 'Use a file up to 10 MiB and metadata up to 16 KiB.');
  }

  const body = new FormData();
  body.set('metadata', metadataText);
  body.set('file', file);
  return requestLocal('/api/sources/uploads', UploadResponseSchema, { method: 'POST', body, signal }, true);
}
