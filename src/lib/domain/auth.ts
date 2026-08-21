import { z } from "zod";

export const administratorIdentifierLimits = {
  minimumCodePoints: 3,
  maximumCodePoints: 254,
} as const;

export const administratorPasswordLimits = {
  minimumNewPasswordCodePoints: 16,
  maximumCodePoints: 128,
  maximumUtf8Bytes: 512,
} as const;

const administratorUsernamePattern = /^[a-z0-9._-]+$/;
const administratorEmailSchema = z.email();

export function unicodeCodePointLength(value: string): number {
  return [...value].length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function canonicalizeAdministratorIdentifier(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export const administratorIdentifierSchema = z
  .string()
  .transform(canonicalizeAdministratorIdentifier)
  .superRefine((identifier, context) => {
    const length = unicodeCodePointLength(identifier);
    if (
      length < administratorIdentifierLimits.minimumCodePoints ||
      length > administratorIdentifierLimits.maximumCodePoints
    ) {
      context.addIssue({
        code: "custom",
        message: "Administrator identifier length is invalid",
      });
    }
    const formatValid = identifier.includes("@")
      ? administratorEmailSchema.safeParse(identifier).success
      : administratorUsernamePattern.test(identifier);
    if (!formatValid) {
      context.addIssue({
        code: "custom",
        message: "Administrator identifier format is invalid",
      });
    }
  });

export const administratorPasswordSchema = z.string().superRefine((password, context) => {
  if (unicodeCodePointLength(password) > administratorPasswordLimits.maximumCodePoints) {
    context.addIssue({ code: "custom", message: "Password has too many characters" });
  }
  if (utf8ByteLength(password) > administratorPasswordLimits.maximumUtf8Bytes) {
    context.addIssue({ code: "custom", message: "Password has too many bytes" });
  }
});

export const newAdministratorPasswordSchema = administratorPasswordSchema.superRefine(
  (password, context) => {
    if (
      unicodeCodePointLength(password) <
      administratorPasswordLimits.minimumNewPasswordCodePoints
    ) {
      context.addIssue({
        code: "custom",
        message: "A new administrator password must contain at least 16 characters",
      });
    }
  },
);

export const passwordAuthenticationBodySchema = z
  .object({
    adminId: administratorIdentifierSchema,
    password: administratorPasswordSchema,
  })
  .strict();

export type PasswordAuthenticationBody = z.infer<typeof passwordAuthenticationBodySchema>;

export const authenticatorTransportSchema = z.enum([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

export const passkeyRecordSchema = z
  .object({
    id: z.string().min(1).max(1024),
    publicKey: z.string().min(1).max(4096),
    counter: z.number().int().nonnegative(),
    transports: z.array(authenticatorTransportSchema).max(8).optional(),
    createdAt: z.iso.datetime(),
    label: z.string().trim().min(1).max(80),
  })
  .strict();

export type PasskeyRecord = z.infer<typeof passkeyRecordSchema>;

export const authLifecycleStates = [
  "UNCONFIGURED",
  "BOOTSTRAP_READY",
  "ACTIVE",
  "RECOVERY",
] as const;

export const authLifecycleStateSchema = z.enum(authLifecycleStates);
export type AuthLifecycleState = z.infer<typeof authLifecycleStateSchema>;

export const authStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    state: authLifecycleStateSchema,
    revision: z.number().int().nonnegative(),
    administratorUserId: z.string().max(128),
    sessionEpoch: z.number().int().nonnegative(),
    passkeys: z.array(passkeyRecordSchema).max(20),
    recoveryCodeHashes: z.array(z.string().length(64)).max(10),
    revokedSessionHashes: z.array(z.string().length(64)).max(250),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.state === "UNCONFIGURED" &&
      (record.administratorUserId ||
        record.passkeys.length ||
        record.recoveryCodeHashes.length ||
        record.sessionEpoch !== 0)
    ) {
      context.addIssue({ code: "custom", message: "Unconfigured authentication record is invalid" });
    }
    if (
      record.state === "BOOTSTRAP_READY" &&
      (record.passkeys.length || record.recoveryCodeHashes.length)
    ) {
      context.addIssue({ code: "custom", message: "Bootstrap-ready authentication record is invalid" });
    }
    if (
      (record.state === "ACTIVE" || record.state === "RECOVERY") &&
      (!record.administratorUserId || !record.passkeys.length || !record.recoveryCodeHashes.length)
    ) {
      context.addIssue({ code: "custom", message: "Configured authentication record is invalid" });
    }
  });

export type AuthState = z.infer<typeof authStateSchema>;

export const emptyAuthState = (): AuthState => ({
  schemaVersion: 2,
  state: "BOOTSTRAP_READY",
  revision: 0,
  administratorUserId: "",
  sessionEpoch: 0,
  passkeys: [],
  recoveryCodeHashes: [],
  revokedSessionHashes: [],
});

const legacyAuthStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    administratorUserId: z.string().max(128),
    bootstrapDisabled: z.boolean(),
    sessionEpoch: z.number().int().nonnegative(),
    passkeys: z.array(passkeyRecordSchema).max(20),
    recoveryCodeHashes: z.array(z.string().length(64)).max(10),
    revokedSessionHashes: z.array(z.string().length(64)).max(250),
  })
  .strict();

/** Parse the single authentication record and migrate the former v1 shape in memory. */
export function parseAuthState(value: unknown): AuthState {
  const current = authStateSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyAuthStateSchema.parse(value);
  const state: AuthLifecycleState = legacy.bootstrapDisabled
    ? legacy.passkeys.length
      ? "ACTIVE"
      : "RECOVERY"
    : "BOOTSTRAP_READY";
  return authStateSchema.parse({
    schemaVersion: 2,
    state,
    revision: legacy.revision,
    administratorUserId: legacy.administratorUserId,
    sessionEpoch: legacy.sessionEpoch,
    passkeys: legacy.passkeys,
    recoveryCodeHashes: legacy.recoveryCodeHashes,
    revokedSessionHashes: legacy.revokedSessionHashes,
  });
}

export const ceremonyPurposes = [
  "login",
  "bootstrap",
  "step-up",
  "add-passkey",
  "recovery",
] as const;

export type CeremonyPurpose = (typeof ceremonyPurposes)[number];

export type SessionClaims = {
  typ: "session-v1";
  sid: string;
  administrator: string;
  epoch: number;
  issuedAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
};

export type PreAuthClaims = {
  typ: "preauth-v1";
  sid: string;
  administrator: string;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
};

export type BootstrapPreAuthClaims = {
  typ: "bootstrap-preauth-v1";
  sid: string;
  administrator: string;
  epoch: number;
  recordRevision: number;
  issuedAt: number;
  expiresAt: number;
};

export type CeremonyClaims = {
  typ: "ceremony-v1";
  purpose: CeremonyPurpose;
  challenge: string;
  jti: string;
  boundSessionHash: string;
  administrator: string;
  recordRevision: number;
  label?: string;
  recoveryCodeHash?: string;
  issuedAt: number;
  expiresAt: number;
};

export type StepUpClaims = {
  typ: "stepup-v2";
  sid: string;
  jti: string;
  action: "manage-passkeys";
  assurance: "password-and-passkey";
  issuedAt: number;
  expiresAt: number;
};

export type PasswordStepUpClaims = {
  typ: "stepup-password-v1";
  sid: string;
  administrator: string;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
};

export type RecoveryClaims = {
  typ: "recovery-v1";
  sid: string;
  administrator: string;
  recoveryCodeHash: string;
  issuedAt: number;
  expiresAt: number;
};
