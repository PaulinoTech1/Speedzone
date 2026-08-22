import { describe, expect, it } from "vitest";

import { estimateUpfrontCost, massachusettsFees } from "@/lib/domain/ownership-costs";

const fixedFees =
  massachusettsFees.titleFee + massachusettsFees.registrationFee + massachusettsFees.inspectionFee;

describe("estimateUpfrontCost", () => {
  it("applies the Massachusetts 6.25% rate plus fixed RMV fees", () => {
    const result = estimateUpfrontCost(3500);
    expect(result.salesTax).toBe(219);
    expect(result.feesSubtotal).toBe(219 + fixedFees);
    expect(result.total).toBe(3500 + 219 + fixedFees);
  });

  it("scales sales tax with price", () => {
    expect(estimateUpfrontCost(8000).salesTax).toBe(500);
    expect(estimateUpfrontCost(2500).salesTax).toBe(156);
  });

  it("keeps fixed fees constant regardless of price", () => {
    for (const price of [2000, 5000, 12000]) {
      const result = estimateUpfrontCost(price);
      expect(result.titleFee).toBe(massachusettsFees.titleFee);
      expect(result.registrationFee).toBe(massachusettsFees.registrationFee);
      expect(result.inspectionFee).toBe(massachusettsFees.inspectionFee);
    }
  });

  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])(
    "treats the invalid price %p as zero rather than producing NaN",
    (price) => {
      const result = estimateUpfrontCost(price);
      expect(result.price).toBe(0);
      expect(result.salesTax).toBe(0);
      expect(result.total).toBe(fixedFees);
      expect(Number.isNaN(result.total)).toBe(false);
    },
  );
});
