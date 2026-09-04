import { describe, expect, it } from "vitest";

import { testDriveRequestSchema } from "@/lib/domain/test-drive";

function futureDate(daysFromNow = 3): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function pastDate(daysAgo = 3): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Jamie Rivera",
    email: "jamie@example.com",
    phone: "(508) 826-9405",
    vehicleOfInterest: "2021 Ford Mustang GT",
    preferredDate: futureDate(),
    preferredTime: "morning",
    comments: "Looking forward to it!",
    website: "",
    ...overrides,
  };
}

describe("testDriveRequestSchema", () => {
  it("accepts a request without scheduling preferences", () => {
    const result = testDriveRequestSchema.safeParse(
      submission({ preferredDate: "", preferredTime: "" }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts a complete, valid submission", () => {
    const result = testDriveRequestSchema.safeParse(submission());
    expect(result.success).toBe(true);
  });

  it("trims and defaults optional fields", () => {
    const result = testDriveRequestSchema.safeParse(
      submission({ fullName: "  Jamie Rivera  ", comments: undefined }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fullName).toBe("Jamie Rivera");
      expect(result.data.comments).toBe("");
    }
  });

  it.each([
    ["missing full name", { fullName: "" }],
    ["missing email", { email: "" }],
    ["invalid email", { email: "not-an-email" }],
    ["invalid phone", { phone: "abc" }],
    ["missing vehicle of interest", { vehicleOfInterest: "" }],
    ["invalid preferred time", { preferredTime: "midnight" }],
    ["malformed date", { preferredDate: "not-a-date" }],
    ["a date in the past", { preferredDate: pastDate() }],
  ])("rejects %s", (_name, overrides) => {
    const result = testDriveRequestSchema.safeParse(submission(overrides));
    expect(result.success).toBe(false);
  });

  it("rejects a filled-in honeypot field", () => {
    const result = testDriveRequestSchema.safeParse(submission({ website: "http://spam.example" }));
    expect(result.success).toBe(false);
  });

  it("rejects unexpected extra fields", () => {
    const result = testDriveRequestSchema.safeParse(submission({ role: "admin" }));
    expect(result.success).toBe(false);
  });

  it("accepts today as the preferred date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = testDriveRequestSchema.safeParse(submission({ preferredDate: today }));
    expect(result.success).toBe(true);
  });
});
