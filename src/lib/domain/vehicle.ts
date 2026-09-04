import { z } from "zod";

export const vehicleStatuses = ["draft", "published", "pending", "sold", "archived"] as const;
export const vehicleStatusSchema = z.enum(vehicleStatuses);
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>;

const shortText = (maximum: number) => z.string().trim().max(maximum);

export const vehiclePhotoSchema = z
  .object({
    url: z.url().max(2048),
    pathname: z.string().trim().min(1).max(512),
    width: z.number().int().min(1).max(1600),
    height: z.number().int().min(1).max(1600),
    bytes: z.number().int().min(1).max(4 * 1024 * 1024),
    alt: shortText(180),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type VehiclePhoto = z.infer<typeof vehiclePhotoSchema>;

const publishedSanityDocumentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/, "Invalid Sanity document ID")
  .refine(
    (value) => !value.startsWith("drafts.") && !value.startsWith("versions."),
    "Expected a published Sanity document ID",
  );

const vehicleFieldsSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().optional(),
    stockNumber: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/)
      .transform((value) => value.toUpperCase()),
    vin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must contain 17 valid characters"),
    year: z.number().int().min(1886).max(new Date().getUTCFullYear() + 1),
    make: shortText(80).pipe(z.string().min(1)),
    model: shortText(80).pipe(z.string().min(1)),
    trim: shortText(80),
    price: z.number().int().nonnegative().max(100_000_000),
    mileage: z.number().int().nonnegative().max(10_000_000),
    exteriorColor: shortText(80),
    interiorColor: shortText(80),
    bodyStyle: shortText(80),
    transmission: shortText(80),
    drivetrain: shortText(80),
    fuelType: shortText(80),
    engine: shortText(120),
    description: z.string().trim().max(5000),
    features: z.array(shortText(120).pipe(z.string().min(1))).max(50),
    status: vehicleStatusSchema,
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    photographs: z.array(vehiclePhotoSchema).max(12),
  })
  .strict();

function requirePublishedPhoto(
  vehicle: { status: VehicleStatus; photographs: readonly unknown[] },
  context: z.RefinementCtx,
): void {
    if (vehicle.status === "published" && vehicle.photographs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["photographs"],
        message: "A published vehicle needs at least one photograph",
      });
    }
}

export const vehicleInputSchema = vehicleFieldsSchema.superRefine(requirePublishedPhoto);

export type VehicleInput = z.infer<typeof vehicleInputSchema>;

export const vehicleRecordSchema = vehicleFieldsSchema
  .omit({ expectedVersion: true })
  .extend({
    id: publishedSanityDocumentIdSchema,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(requirePublishedPhoto);

export type VehicleRecord = z.infer<typeof vehicleRecordSchema>;

export const inventoryStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    vehicles: z.array(vehicleRecordSchema).max(500),
  })
  .strict();

export type InventoryState = z.infer<typeof inventoryStateSchema>;

export const emptyInventoryState = (): InventoryState => ({
  schemaVersion: 1,
  revision: 0,
  vehicles: [],
});

const transitions: Record<VehicleStatus, readonly VehicleStatus[]> = {
  draft: ["draft", "published", "pending", "archived"],
  published: ["draft", "published", "pending", "sold", "archived"],
  pending: ["draft", "published", "pending", "sold", "archived"],
  sold: ["published", "sold", "archived"],
  archived: ["draft", "archived"],
};

export function canTransitionVehicle(from: VehicleStatus, to: VehicleStatus): boolean {
  return transitions[from].includes(to);
}

export function publicVehicle(vehicle: VehicleRecord): VehicleRecord | null {
  return vehicle.status === "published" ? vehicle : null;
}
