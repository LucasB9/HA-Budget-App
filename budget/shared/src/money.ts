export type Cents = number;

const eurFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

const eurNoDecimals = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export function eurosToCents(euros: number): Cents {
  return Math.round(euros * 100);
}

export function centsToEuros(cents: Cents): number {
  return cents / 100;
}

export function formatEur(cents: Cents, opts: { compact?: boolean } = {}): string {
  const formatter = opts.compact && cents % 100 === 0 ? eurNoDecimals : eurFormatter;
  return formatter.format(cents / 100);
}

/** Parses user input such as "12,50", "12.5" or "1 200" into cents. Returns null when invalid. */
export function parseEuroInput(input: string): Cents | null {
  const cleaned = input.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return eurosToCents(Number(cleaned));
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')} %`;
}
