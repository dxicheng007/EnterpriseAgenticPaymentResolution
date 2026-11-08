import {
  PreviewRequestSchema, PreviewResponseSchema, type PreviewRequest, type PreviewResponse,
} from '../../contracts/src/runtime.js';
import { jsonPost, requestLocal } from './http.js';

export async function previewConnector(request: PreviewRequest, signal?: AbortSignal): Promise<PreviewResponse> {
  return requestLocal('/api/connectors/preview', PreviewResponseSchema,
    jsonPost(PreviewRequestSchema.parse(request), signal), true);
}
