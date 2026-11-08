const dollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatUsdCents(cents: number): string {
  const magnitude = BigInt(Math.abs(cents));
  const whole = dollars.format(magnitude / 100n);
  const fraction = String(magnitude % 100n).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${whole}.${fraction}`;
}

export function recordField(record: object, pointer: string): unknown {
  if (pointer === '') return record;
  let value: unknown = record;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
