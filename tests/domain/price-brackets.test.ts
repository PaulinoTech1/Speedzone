import { describe, expect, it } from "vitest";

import { formatBracket, parsePriceBracket, priceBrackets } from "@/lib/domain/price-brackets";

describe("parsePriceBracket", () => {
  it.each(priceBrackets)("accepts the published bracket %i", (bracket) => {
    expect(parsePriceBracket(String(bracket))).toBe(bracket);
  });

  it.each([
    ["an unpublished amount", "4000"],
    ["a non-numeric value", "cheap"],
    ["an empty string", ""],
    ["a negative amount", "-5000"],
    ["a decimal", "5000.5"],
    ["an absurd amount", "9999999"],
  ])("rejects %s", (_name, raw) => {
    expect(parsePriceBracket(raw)).toBeNull();
  });
});

describe("formatBracket", () => {
  it("formats amounts as whole-dollar USD", () => {
    expect(formatBracket(5000)).toBe("$5,000");
    expect(formatBracket(15000)).toBe("$15,000");
  });
});
