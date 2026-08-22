/**
 * Price brackets exist to capture budget-intent searches ("cars under $5,000
 * worcester") as additive filters. They deliberately do not cap the lot: the
 * main inventory page always lists every published vehicle, including any
 * priced above the largest bracket.
 */
export const priceBrackets = [3000, 5000, 7500, 10000, 15000] as const;

export type PriceBracket = (typeof priceBrackets)[number];

export function isPriceBracket(value: number): value is PriceBracket {
  return (priceBrackets as readonly number[]).includes(value);
}

export function parsePriceBracket(raw: string): PriceBracket | null {
  if (!/^\d{3,6}$/.test(raw)) return null;
  const value = Number(raw);
  return isPriceBracket(value) ? value : null;
}

export function formatBracket(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
