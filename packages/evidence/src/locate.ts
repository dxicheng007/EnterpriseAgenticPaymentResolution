import { canonicalJson, type EvidenceRef, type Id, type JsonValue } from '@eapr/contracts';

export type ExtractedDocument =
  | {kind:'pdf'; pages:string[]}
  | {kind:'csv'; headers:string[]; rows:string[][]}
  | {kind:'json'; value:JsonValue}
  | {kind:'email'; messageId:Id; body:string};

export class CitationError extends Error {
  constructor() {
    super('CITATION_INVALID');
  }
}

function span(value: string | undefined, startInclusive: number, endExclusive: number) {
  if (value === undefined || !Number.isSafeInteger(startInclusive) ||
      !Number.isSafeInteger(endExclusive) || startInclusive < 0 ||
      startInclusive >= endExclusive || endExclusive > value.length) {
    throw new CitationError();
  }
  const splitsPair = (index: number) =>
    index > 0 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(value.slice(index - 1, index + 1));
  if (splitsPair(startInclusive) || splitsPair(endExclusive)) throw new CitationError();
  return {value, startInclusive, endExclusive, excerpt:value.slice(startInclusive, endExclusive)};
}

function pointerValue(root: JsonValue, pointer: string): JsonValue {
  if (pointer === '') return root;
  if (!pointer.startsWith('/') || /~(?![01])/.test(pointer)) throw new CitationError();
  let value = root;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) throw new CitationError();
      value = value[Number(key)]!;
    } else if (value !== null && typeof value === 'object' && Object.hasOwn(value, key)) {
      value = value[key]!;
    } else {
      throw new CitationError();
    }
  }
  return value;
}

export function locate(document: ExtractedDocument, locator: EvidenceRef['locator']) {
  if (locator.kind === 'pdf' && document.kind === 'pdf') {
    return span(document.pages[locator.page - 1], locator.start, locator.end);
  }
  if (locator.kind === 'email' && document.kind === 'email' && locator.messageId === document.messageId) {
    return span(document.body, locator.start, locator.end);
  }
  if (locator.kind === 'csv' && document.kind === 'csv') {
    const value = document.rows[locator.row - 1]?.[document.headers.indexOf(locator.column)];
    return span(value, 0, value?.length ?? 0);
  }
  if (locator.kind === 'json' && document.kind === 'json') {
    const selected = pointerValue(document.value, locator.pointer);
    const value = typeof selected === 'string' ? selected : canonicalJson(selected);
    return span(value, 0, value.length);
  }
  throw new CitationError();
}
