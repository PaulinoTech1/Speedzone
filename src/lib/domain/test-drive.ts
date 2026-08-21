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
      .regex(isoDatePattern, "Enter a valid date")
      .refine(isTodayOrLater, "Preferred date must be today or later"),
    preferredTime: z.string().refine(isTestDriveTimeSlot, "Choose a preferred time"),
    comments: trimmedText(1000).default(""),
    // Hidden from real visitors via CSS; any bot that fills it fails validation.
    website: trimmedText(0).default(""),
  })
  .strict();

export type TestDriveRequest = z.infer<typeof testDriveRequestSchema>;
