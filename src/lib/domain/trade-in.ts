import { z } from "zod";

const trimmedText = (maximum: number) => z.string().trim().max(maximum);

export const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

export const tradeInConditions = ["excellent", "good", "fair", "poor", "not-sure"] as const;
export type TradeInCondition = (typeof tradeInConditions)[number];

function isTradeInCondition(value: string): value is TradeInCondition {
  return (tradeInConditions as readonly string[]).includes(value);
}

export const tradeInConditionLabels: Record<TradeInCondition, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Needs work",
  "not-sure": "Not sure",
};

export const tradeInRequestSchema = z
  .object({
    fullName: trimmedText(120).pipe(z.string().min(1, "Full name is required")),
    email: z.email("Enter a valid email address").max(254),
    phone: trimmedText(30).pipe(
      z
        .string()
        .min(7, "Enter a valid phone number")
        .regex(/^[+]?[\d\s().-]{7,30}$/, "Enter a valid phone number"),
    ),
    // Optional: the visitor may not know it, or the "Decode VIN" lookup may fail.
    vin: z
      .string()
      .trim()
      .toUpperCase()
      .max(17)
      .refine((value) => value === "" || vinPattern.test(value), "Enter a valid 17-character VIN")
      .default(""),
    year: z.number().int().min(1900).max(new Date().getUTCFullYear() + 1),
    make: trimmedText(80).pipe(z.string().min(1, "Make is required")),
    model: trimmedText(80).pipe(z.string().min(1, "Model is required")),
    trim: trimmedText(80).default(""),
    // Populated automatically from a successful VIN decode, not directly editable.
    bodyStyle: trimmedText(80).default(""),
    engine: trimmedText(80).default(""),
    transmission: trimmedText(80).default(""),
    drivetrain: trimmedText(80).default(""),
    fuelType: trimmedText(80).default(""),
    mileage: z.number().int().nonnegative().max(999_999),
    condition: z.string().refine(isTradeInCondition, "Choose a condition"),
    comments: trimmedText(1000).default(""),
    // Hidden from real visitors via CSS; any bot that fills it fails validation.
    website: trimmedText(0).default(""),
  })
  .strict();

export type TradeInRequest = z.infer<typeof tradeInRequestSchema>;

export type DecodedVehicle = {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyStyle: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  fuelType: string | null;
};

export const vinDecodeResponseSchema = z.object({
  ok: z.literal(true),
  vehicle: z.object({
    year: z.number().int().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    trim: z.string().nullable(),
    bodyStyle: z.string().nullable(),
    engine: z.string().nullable(),
    transmission: z.string().nullable(),
    drivetrain: z.string().nullable(),
    fuelType: z.string().nullable(),
  }),
  warning: z.string().nullable(),
});

export type VinDecodeResponse = z.infer<typeof vinDecodeResponseSchema>;
