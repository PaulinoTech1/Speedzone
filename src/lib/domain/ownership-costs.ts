/**
 * Massachusetts up-front costs on top of a used vehicle's price.
 *
 * These are published RMV/DOR figures, not a quote. Registration is the
 * standard two-year passenger-plate fee; inspection is the annual safety and
 * emissions test performed at a licensed station, not by the RMV. Excise tax
 * is billed separately by the buyer's city or town and is deliberately not
 * folded into this up-front estimate.
 */
export const massachusettsFees = {
  salesTaxRate: 0.0625,
  titleFee: 75,
  registrationFee: 60,
  inspectionFee: 35,
} as const;

export type CostBreakdown = {
  price: number;
  salesTax: number;
  titleFee: number;
  registrationFee: number;
  inspectionFee: number;
  feesSubtotal: number;
  total: number;
};

export function estimateUpfrontCost(price: number): CostBreakdown {
  const safePrice = Number.isFinite(price) && price > 0 ? Math.round(price) : 0;
  const salesTax = Math.round(safePrice * massachusettsFees.salesTaxRate);
  const feesSubtotal =
    salesTax +
    massachusettsFees.titleFee +
    massachusettsFees.registrationFee +
    massachusettsFees.inspectionFee;

  return {
    price: safePrice,
    salesTax,
    titleFee: massachusettsFees.titleFee,
    registrationFee: massachusettsFees.registrationFee,
    inspectionFee: massachusettsFees.inspectionFee,
    feesSubtotal,
    total: safePrice + feesSubtotal,
  };
}
