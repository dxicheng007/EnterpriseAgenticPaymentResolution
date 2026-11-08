import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { getDocument, version as pdfVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { IdSchema, JsonValueSchema, type UploadMetadata } from '@eapr/contracts';
import type { ExtractedDocument } from './locate.js';

export type MediaType = 'application/pdf' | 'text/csv' | 'application/json';
export type Extraction = {document:ExtractedDocument; extractor:string; mediaType:MediaType};

export class SourceContentError extends Error {
  constructor(cause?: Error) {
    super('SOURCE_CONTENT_INVALID', {cause});
  }
}

function decode(bytes: Uint8Array) {
  return new TextDecoder('utf-8', {fatal:true}).decode(bytes);
}

const pdfResources = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const loading = getDocument({
    data:Uint8Array.from(bytes), stopAtErrors:true,
    useSystemFonts:false, disableFontFace:true,
    standardFontDataUrl:join(pdfResources,'standard_fonts') + sep,
    cMapUrl:join(pdfResources,'cmaps') + sep,
  });
  try {
    const pdf = await loading.promise;
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent({disableNormalization:true});
      pages.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' '));
    }
    if (!pages.some(text => /\S/u.test(text))) throw new SourceContentError();
    return {document:{kind:'pdf',pages}, mediaType:'application/pdf', extractor:'pdfjs-dist@' + pdfVersion};
  } finally {
    await loading.destroy();
  }
}

export async function extractDocument(kind: UploadMetadata['kind'] | 'api_json', bytes: Uint8Array): Promise<Extraction> {
  try {
    if (kind === 'contract_pdf' || kind === 'amendment_pdf') return await extractPdf(bytes);
    if (kind === 'event_csv') {
      const [headers, ...rows] = parse(decode(bytes));
      if (!headers?.length || headers.some(header => header.length === 0) || new Set(headers).size !== headers.length) {
        throw new SourceContentError();
      }
      return {document:{kind:'csv',headers,rows}, mediaType:'text/csv', extractor:'csv-records@1'};
    }
    const value = JsonValueSchema.parse(JSON.parse(decode(bytes)));
    if (kind === 'api_json') {
      return {document:{kind:'json',value}, mediaType:'application/json', extractor:'json-pointer@1'};
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 2 || typeof value.body !== 'string' || !value.body.trim()) {
      throw new SourceContentError();
    }
    const messageId = IdSchema.parse(value.messageId);
    return {document:{kind:'email',messageId,body:value.body}, mediaType:'application/json', extractor:'email-export@1'};
  } catch (error) {
    if (error instanceof SourceContentError) throw error;
    throw new SourceContentError(error instanceof Error ? error : undefined);
  }
}
