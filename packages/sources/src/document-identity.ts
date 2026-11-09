import { IsoDateSchema, type Id, type IsoInstant } from '@eapr/contracts';

const idPattern = '([A-Za-z0-9][A-Za-z0-9._:-]{0,159})';
const datePattern = '(\\d{4}-\\d{2}-\\d{2})';
const amountPattern = '(?:0|[1-9]\\d*)\\.\\d{2}';
// PDF.js joins text items with spaces, including empty items at line breaks.
const agreementHeader = 'Fixed monthly agreement ' + idPattern + ' +Seller ' + idPattern +
  '; buyer ' + idPattern + '; account ' + idPattern +
  ' +Legal name ([A-Za-z0-9]+(?: [A-Za-z0-9]+)*) +Monthly fee USD ' + amountPattern;
const agreementFormats = [
  new RegExp('^' + agreementHeader + ' +Effective ' + datePattern + '; monthly invoice anchor day 1\\.$'),
  new RegExp('^' + agreementHeader + ' effective ' + datePattern + '\\. +Monthly invoice anchor day 1\\.$'),
];
const directoryHeader = new RegExp('^Seller ' + idPattern + ' reports separate customer accounts: (.+)\\. Currency USD\\.$');
const directoryEntry = new RegExp('^' + idPattern + ' belongs to ' + idPattern + '$');

export function fullMatch(pattern: RegExp, text: string) {
  const match = pattern.exec(text);
  return match?.[0] === text ? match : undefined;
}

export type Party = { sellerEntityId: Id; sourceBuyerId: Id; citationId: Id };
export type DirectoryClaim = Party & { sourceAccountId: Id };
export type Agreement = DirectoryClaim & { contractId: Id; displayName: string };

export function parseAgreement({ text, citationId }: { text: string; citationId: Id }, asOf: IsoInstant): Agreement | undefined {
  for (const format of agreementFormats) {
    const match = fullMatch(format, text);
    if (!match) continue;
    const [, contractId, sellerEntityId, sourceBuyerId, sourceAccountId, displayName, effective] = match;
    if (IsoDateSchema.safeParse(effective).success && effective <= asOf.slice(0, 10)) {
      return { contractId, sellerEntityId, sourceBuyerId, sourceAccountId, displayName, citationId };
    }
  }
}

export function parseDirectory({ text, citationId }: { text: string; citationId: Id }): DirectoryClaim[] {
  const match = fullMatch(directoryHeader, text);
  if (!match) return [];
  const [, sellerEntityId, entries] = match;
  const claims: DirectoryClaim[] = [];
  for (const entry of entries.split('; ')) {
    const parsed = fullMatch(directoryEntry, entry);
    if (!parsed) return [];
    const [, sourceAccountId, sourceBuyerId] = parsed;
    claims.push({ sellerEntityId, sourceAccountId, sourceBuyerId, citationId });
  }
  return claims;
}
