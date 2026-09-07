import { z } from "zod";

const trimmedText = (maximum: number) => z.string().trim().max(maximum);

export const testDriveTimeSlots = ["morning", "midday", "afternoon"] as const;
export type TestDriveTimeSlot = (typeof testDriveTimeSlots)[number];

function isTestDriveTimeSlot(value: string): value is TestDriveTimeSlot {
  return (testDriveTimeSlots as readonly string[]).includes(value);
}

export const testDriveTimeSlotLabels: Record<TestDriveTimeSlot, string> = {
  morning: "Morning (10am – 12pm)",
  midday: "Midday (12 – 2pm)",
  afternoon: "Afternoon (2 – 4pm)",
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isTodayOrLater(value: string): boolean {
  // Compares calendar dates in UTC so a submission near midnight never fails
  // on the server purely because the client's local date already rolled over.
  const today = new Date();
  const todayIso = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  return value >= todayIso;
}

export const testDriveRequestSchema = z
  .object({
    fullName: trimmedText(120).pipe(z.string().min(1, "Full name is required")),
    email: z.email("Enter a valid email address").max(254),
    phone: trimmedText(30).pipe(
      z
        .string()
        .min(7, "Enter a valid phone number")
        .regex(/^[+]?[\d\s().-]{7,30}$/, "Enter a valid phone number"),
    ),
    vehicleOfInterest: trimmedText(160).pipe(
      z.string().min(1, "Let us know which vehicle you're interested in"),
    ),
    preferredDate: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || isoDatePattern.test(value),
        "Enter a valid date",
      )
      .refine(
        (value) => value === "" || isTodayOrLater(value),
        "Preferred date must be today or later",
      )
      .default(""),
    preferredTime: z
      .string()
      .refine(
        (value) => value === "" || isTestDriveTimeSlot(value),
        "Choose a preferred time",
      )
      .default(""),
    comments: trimmedText(1000).default(""),
    // Hidden from real visitors via CSS; any bot that fills it fails validation.
    website: trimmedText(0).default(""),
  })
  .strict();

export type TestDriveRequest = z.infer<typeof testDriveRequestSchema>;

export type VettedTestDriveRequest = Omit<TestDriveRequest, "website"> & {
  status: "pending_review";
  source: "public_test_drive_form";
};

function sanitizePlainText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function vetTestDriveRequest(request: TestDriveRequest): VettedTestDriveRequest {
  return {
    status: "pending_review",
    source: "public_test_drive_form",
    fullName: sanitizePlainText(request.fullName),
    email: request.email.trim().toLowerCase(),
    phone: sanitizePlainText(request.phone),
    vehicleOfInterest: sanitizePlainText(request.vehicleOfInterest),
    preferredDate: request.preferredDate,
    preferredTime: request.preferredTime,
    comments: sanitizePlainText(request.comments),
  };
}
