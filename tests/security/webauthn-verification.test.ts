import { createHash, randomBytes } from "node:crypto";

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { CBORType } from "@levischuck/tiny-cbor";
import { describe, expect, it } from "vitest";

import type { AuthState, CeremonyClaims } from "@/lib/domain/auth";
import { base64url } from "@/lib/server/crypto";
import {
  verifyAuthentication,
  verifyRegistration,
} from "@/lib/server/auth/webauthn";

const challenge = base64url(randomBytes(32));
const credentialId = base64url(randomBytes(32));
const ceremony: CeremonyClaims = {
  typ: "ceremony-v1",
  purpose: "login",
  challenge,
  jti: "test-jti",
  boundSessionHash: "test-binding",
  administrator: "administrator",
  recordRevision: 0,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};
const state: AuthState = {
  schemaVersion: 2,
  state: "ACTIVE",
  revision: 0,
  administratorUserId: "admin",
  sessionEpoch: 0,
  passkeys: [
    {
      id: credentialId,
      publicKey: base64url(randomBytes(77)),
      counter: 0,
      transports: ["internal"],
      createdAt: new Date().toISOString(),
      label: "Test key",
    },
  ],
  recoveryCodeHashes: ["a".repeat(64)],
  revokedSessionHashes: [],
};

function response(origin: string, rpID: string, flags: number): AuthenticationResponseJSON {
  const authenticatorData = Buffer.alloc(37);
  createHash("sha256").update(rpID).digest().copy(authenticatorData, 0);
  authenticatorData[32] = flags;
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
  );
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
    response: {
      authenticatorData: base64url(authenticatorData),
      clientDataJSON: base64url(clientDataJSON),
      signature: base64url(randomBytes(64)),
    },
  };
}

function registrationResponse(
  origin: string,
  rpID: string,
  flags: number,
): RegistrationResponseJSON {
  const credentialBytes = randomBytes(32);
  const credentialPublicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, randomBytes(32)],
      [-3, randomBytes(32)],
    ]),
  );
  const authenticatorData = Buffer.alloc(
    32 + 1 + 4 + 16 + 2 + credentialBytes.length + credentialPublicKey.byteLength,
  );
  createHash("sha256").update(rpID).digest().copy(authenticatorData, 0);
  authenticatorData[32] = flags;
  randomBytes(16).copy(authenticatorData, 37);
  authenticatorData.writeUInt16BE(credentialBytes.length, 53);
  credentialBytes.copy(authenticatorData, 55);
  authenticatorData.set(credentialPublicKey, 55 + credentialBytes.length);

  const attestationObject = isoCBOR.encode(
    new Map<string | number, CBORType>([
      ["fmt", "none"],
      ["authData", authenticatorData],
      ["attStmt", new Map<string | number, CBORType>()],
    ]),
  );
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }),
  );
  const id = base64url(credentialBytes);
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
    response: {
      attestationObject: base64url(attestationObject),
      clientDataJSON: base64url(clientDataJSON),
      transports: ["internal"],
    },
  };
}

describe("real SimpleWebAuthn boundary validation", () => {
  it("rejects an incorrect explicit origin", async () => {
    await expect(
      verifyAuthentication(response("https://evil.example", "localhost", 0x05), ceremony, state),
    ).rejects.toThrow(/origin/i);
  });

  it("rejects an incorrect RP ID hash", async () => {
    await expect(
      verifyAuthentication(response("http://localhost:4173", "wrong.example", 0x05), ceremony, state),
    ).rejects.toThrow(/RP ID/i);
  });

  it("rejects an assertion without the user-verification flag", async () => {
    await expect(
      verifyAuthentication(response("http://localhost:4173", "localhost", 0x01), ceremony, state),
    ).rejects.toThrow(/verification/i);
  });

  it("rejects initial registration from an incorrect explicit origin", async () => {
    await expect(
      verifyRegistration(
        registrationResponse("https://evil.example", "localhost", 0x45),
        { ...ceremony, purpose: "bootstrap", label: "Primary" },
      ),
    ).rejects.toThrow(/origin/i);
  });

  it("rejects initial registration with an incorrect RP ID hash", async () => {
    await expect(
      verifyRegistration(
        registrationResponse("http://localhost:4173", "wrong.example", 0x45),
        { ...ceremony, purpose: "bootstrap", label: "Primary" },
      ),
    ).rejects.toThrow(/RP ID/i);
  });

  it("rejects initial registration without the user-verification flag", async () => {
    await expect(
      verifyRegistration(
        registrationResponse("http://localhost:4173", "localhost", 0x41),
        { ...ceremony, purpose: "bootstrap", label: "Primary" },
      ),
    ).rejects.toThrow(/verification/i);
  });
});
