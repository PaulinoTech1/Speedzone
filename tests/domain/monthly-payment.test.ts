import { describe, expect, it } from "vitest";
import { calculateMonthlyPayment, parseCalculatorInput } from "@/lib/domain/monthly-payment";

describe("monthly payment input validation", () => {
  it("accepts the limit and rejects amounts above it", () => {
    expect(parseCalculatorInput("99,999", "money").value).toBe(99999);
    for (const raw of ["100000", "100,000", "99999.01", "100001"]) {
      expect(parseCalculatorInput(raw, "money").error).toBe("Error 99,999 limit");
    }
  });
  it("rejects negative, malformed, non-finite and injected inputs", () => {
    for (const raw of ["-1", "", "Infinity", "NaN", "1e3", "1,00", "100abc", "<script>", "1.234"]) {
      expect(parseCalculatorInput(raw, "money").error).toBeTruthy();
    }
  });
  it("requires APR precision and valid whole-month terms", () => {
    expect(parseCalculatorInput("6.25", "apr").value).toBe(6.25);
    for (const raw of ["6.251", "-1", "101"]) expect(parseCalculatorInput(raw, "apr").error).toBeTruthy();
    for (const raw of ["0", "-12", "12.5", "121"]) expect(parseCalculatorInput(raw, "term").error).toBeTruthy();
  });
});

describe("monthly payment calculation", () => {
  it("calculates amortized and zero-interest payments", () => {
    expect(calculateMonthlyPayment(25000, 5000, 60, 6)).toBeCloseTo(386.66, 2);
    expect(calculateMonthlyPayment(25000, 5000, 60, 0)).toBeCloseTo(333.33, 2);
    expect(calculateMonthlyPayment(25000, 25000, 60, 6)).toBe(0);
  });
  it("rejects overpayments and invalid arithmetic inputs", () => {
    expect(() => calculateMonthlyPayment(100, 101, 60, 6)).toThrow();
    expect(() => calculateMonthlyPayment(100, 0, 0, 6)).toThrow();
    expect(() => calculateMonthlyPayment(NaN, 0, 60, 6)).toThrow();
  });
});
