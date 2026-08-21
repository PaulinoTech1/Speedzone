import "server-only";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { NextRequest, NextResponse } from "next/server";

import type {
  AuthState,
  CeremonyClaims,
  CeremonyPurpose,
  PasskeyRecord,
} from "@/lib/domain/auth";
import { cookieNames, setHostCookie } from "@/lib/server/cookies";
import {
  base64url,
  fromBase64url,
  hmacSha256,
  randomToken,
} from "@/lib/server/crypto";
import { adminConfig, tokenConfig, webAuthnConfig } from "@/lib/server/env";
import { consumeOnce } from "@/lib/server/storage/consume-once";
import { openToken, sealToken } from "@/lib/server/token";

const ceremonyLifetimeSeconds = 5 * 60;

export function ceremonyBinding(sessionId: string): string {
  return hmacSha256(tokenConfig().hashKey, `ceremony-bind:${sessionId}`);
}

function createCeremony(
  state: AuthState,
  purpose: CeremonyPurpose,
  challenge: string,
  sessionId: string,
  additions: Pick<CeremonyClaims, "label" | "recoveryCodeHash"> = {},
  now = Date.now(),
): CeremonyClaims {
  return {
    typ: "ceremony-v1",
    purpose,
    challenge,
    jti: randomToken(32),
    boundSessionHash: ceremonyBinding(sessionId),
    administrator: adminConfig().identifier,
    recordRevision: state.revision,
    ...additions,
    issuedAt: now,
    expiresAt: now + ceremonyLifetimeSeconds * 1000,
  };
}

export function setCeremony(response: NextResponse, claims: CeremonyClaims): void {
  setHostCookie(response, cookieNames.ceremony, sealToken(claims), ceremonyLifetimeSeconds);
}

export function readCeremony(
  request: NextRequest,
  purpose: CeremonyPurpose,
  sessionId: string,
  state: AuthState,
  now = Date.now(),
): CeremonyClaims | null {
  const claims = openToken<CeremonyClaims>(request.cookies.get(cookieNames.ceremony)?.value);
  if (
    !claims ||
    claims.typ !== "ceremony-v1" ||
    claims.purpose !== purpose ||
    claims.issuedAt > now ||
    claims.expiresAt <= now ||
    claims.boundSessionHash !== ceremonyBinding(sessionId) ||
    claims.administrator !== adminConfig().identifier ||
    claims.recordRevision !== state.revision
  ) {
    return null;
  }
  return claims;
}

export async function burnCeremony(claims: CeremonyClaims): Promise<boolean> {
  const digest = hmacSha256(tokenConfig().hashKey, `challenge:${claims.jti}`);
  return consumeOnce("challenge", digest, claims.expiresAt);
}

export async function authenticationOptions(
  state: AuthState,
  purpose: Extract<CeremonyPurpose, "login" | "step-up">,
  sessionId: string,
) {
  if (state.state !== "ACTIVE" || !state.passkeys.length) {
    throw new Error("Authentication is not active");
  }
  const config = webAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    challenge: fromBase64url(randomToken(32)),
    userVerification: "required",
    allowCredentials: state.passkeys.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    })),
  });
  return { options, ceremony: createCeremony(state, purpose, options.challenge, sessionId) };
}

export async function registrationOptions(
  state: AuthState,
  purpose: Extract<CeremonyPurpose, "bootstrap" | "add-passkey" | "recovery">,
  sessionId: string,
  label: string,
  recoveryCodeHash?: string,
) {
  const validState =
    (purpose === "bootstrap" && state.state === "BOOTSTRAP_READY") ||
    (purpose === "add-passkey" && state.state === "ACTIVE") ||
    (purpose === "recovery" && state.state === "RECOVERY");
  if (!validState) throw new Error("Registration is not available");
  const config = webAuthnConfig();
  const administrator = adminConfig().identifier;
  const stableUserIdHex = hmacSha256(tokenConfig().hashKey, `webauthn-user:${administrator}`);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID: new Uint8Array(Buffer.from(stableUserIdHex, "hex")),
    userName: administrator,
    userDisplayName: administrator,
    challenge: fromBase64url(randomToken(32)),
    attestationType: "none",
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: state.passkeys.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  return {
    options,
    ceremony: createCeremony(
      state,
      purpose,
      options.challenge,
      sessionId,
      { label, recoveryCodeHash },
    ),
    administratorUserId: base64url(Buffer.from(stableUserIdHex, "hex")),
  };
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  ceremony: CeremonyClaims,
  state: AuthState,
): Promise<{ credentialId: string; newCounter: number }> {
  if (state.state !== "ACTIVE") throw new Error("Authentication is not active");
  const passkey = state.passkeys.find((candidate) => candidate.id === response.id);
  if (!passkey) throw new Error("Authentication failed");
  const config = webAuthnConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpID,
    credential: {
      id: passkey.id,
      publicKey: fromBase64url(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    },
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    throw new Error("Authentication failed");
  }
  return {
    credentialId: passkey.id,
    newCounter: verification.authenticationInfo.newCounter,
  };
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  ceremony: CeremonyClaims,
): Promise<PasskeyRecord> {
  const config = webAuthnConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpID,
    requireUserPresence: true,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration failed");
  }
  const credential = verification.registrationInfo.credential;
  return {
    id: credential.id,
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    createdAt: new Date().toISOString(),
    label: ceremony.label ?? "Passkey",
  };
}
