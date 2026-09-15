type ParsedInput = { value: number; error?: never } | { value?: never; error: string };

export function parseCalculatorInput(raw: string, kind: "money" | "apr" | "term"): ParsedInput {
  const text = raw.trim();
  // Accept plain decimals and correctly grouped thousands, never exponents or partial numbers.
  const decimal = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  if (!(kind === "term" ? /^\d+$/ : decimal).test(text)) {
    return { error: kind === "term" ? "Enter a whole number of months." : "Enter a non-negative number with at most 2 decimal places." };
  }
  const value = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(value)) return { error: "Enter a valid number." };
  if (kind === "money" && value > 99999) return { error: "Error 99,999 limit" };
  if (kind === "apr" && value > 100) return { error: "APR must be between 0 and 100%." };
  if (kind === "term" && (value < 1 || value > 120)) return { error: "Enter a term from 1 to 120 months." };
  return { value };
}

export function calculateMonthlyPayment(cost: number, downPayment: number, months: number, apr: number): number {
  if (![cost, downPayment, months, apr].every(Number.isFinite) || cost < 0 || downPayment < 0 ||
      downPayment > cost || !Number.isInteger(months) || months < 1 || months > 120 || apr < 0 || apr > 100) {
    throw new RangeError("Invalid monthly payment inputs.");
  }
  const balance = cost - downPayment;
  const rate = apr / 1200;
  return rate === 0 ? balance / months : balance * rate / -Math.expm1(-months * Math.log1p(rate));
}
