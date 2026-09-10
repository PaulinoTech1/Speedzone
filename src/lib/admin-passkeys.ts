import { Redis } from "@upstash/redis";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type CredentialDeviceType,
} from "@simplewebauthn/server";
import { isAdmin } from "@/lib/admin-auth";

const rpName = "SpeedZone Motorsports";
export type WebAuthnConfig = { rpID: string; origin: string };

export function getWebAuthnConfig(headers: Headers): WebAuthnConfig {
  const configuredRpID = process.env.WEBAUTHN_RP_ID?.trim();
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN?.trim();
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim() || "localhost:3000";
  const rpID = configuredRpID || host.split(":")[0] || "localhost";
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return { rpID, origin: configuredOrigin || `${protocol}://${host}` };
}
const userID = "speedzone-admin";
const challengeTtl = 300;

type StoredCredential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  name: string;
};

function redis() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

async function getCredentials() {
  const client = redis();
  return client ? ((await client.get<StoredCredential[]>("speedzone:admin:passkeys")) || []) : [];
}

async function saveCredentials(credentials: StoredCredential[]) {
  const client = redis();
  if (!client) return false;
  await client.set("speedzone:admin:passkeys", credentials);
  return true;
}

export async function revokeAllPasskeysAndChallenges() {
  const client = redis();
  if (!client) return false;
  await client.del("speedzone:admin:passkeys");
  let cursor = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, { match: "speedzone:passkey:*", count: 100 });
    cursor = Number(nextCursor);
    if (keys.length) await client.del(...keys);
  } while (cursor !== 0);
  return true;
}

export type AdminPasskeySummary = { id: string; deviceType: string; backedUp: boolean; name: string };

export async function listPasskeys(): Promise<AdminPasskeySummary[]> {
  const credentials = await getCredentials();
  return credentials.map(({ id, deviceType, backedUp, name }) => ({ id, deviceType, backedUp, name }));
}

export async function deletePasskey(id: string): Promise<{ deleted: boolean; reason?: string }> {
  const credentials = await getCredentials();
  if (!credentials.some((credential) => credential.id === id)) return { deleted: false, reason: "Passkey not found" };
  await saveCredentials(credentials.filter((credential) => credential.id !== id));
  return { deleted: true };
}

export async function registrationOptions(config: WebAuthnConfig) {
  if (!(await isAdmin())) return { error: "Unauthorized" as const };
  const credentials = await getCredentials();
  const options = await generateRegistrationOptions({
    rpName,
    rpID: config.rpID,
    userName: "admin@speedzonemotorsports",
    userDisplayName: "SpeedZone admin",
    userID: new TextEncoder().encode(userID),
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({ id: credential.id, transports: credential.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  const client = redis();
  if (!client) return { error: "Passkey storage is not configured" as const };
  await client.set(`speedzone:passkey:registration:${options.challenge}`, options.challenge, { ex: challengeTtl });
  return { options };
}

export async function verifyRegistration(response: unknown, name: string, config: WebAuthnConfig) {
  if (!(await isAdmin())) return { error: "Unauthorized" as const };
  const client = redis();
  if (!client) return { error: "Passkey storage is not configured" as const };
  const parsed = response as { response?: { clientDataJSON?: string } };
  const clientData = parsed.response?.clientDataJSON;
  if (!clientData) return { error: "Invalid passkey response" as const };
  const challenge = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
  const expected = await client.get<string>(`speedzone:passkey:registration:${challenge}`);
  if (!expected) return { error: "Passkey setup expired" as const };
  const verification = await verifyRegistrationResponse({ response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"], expectedChallenge: expected, expectedOrigin: config.origin, expectedRPID: config.rpID });
  if (!verification.verified || !verification.registrationInfo) return { error: "Passkey could not be verified" as const };
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentials = await getCredentials();
  credentials.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, deviceType: credentialDeviceType, backedUp: credentialBackedUp, name: name || "Unnamed passkey" });
  await saveCredentials(credentials);
  await client.del(`speedzone:passkey:registration:${challenge}`);
  return { verified: true };
}

export async function authenticationOptions(config: WebAuthnConfig) {
  const credentials = await getCredentials();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: credentials.map((credential) => ({ id: credential.id, transports: credential.transports })),
    userVerification: "required",
  });
  const client = redis();
  if (!client) return { error: "Passkey login is not configured" as const };
  await client.set(`speedzone:passkey:authentication:${options.challenge}`, options.challenge, { ex: challengeTtl });
  return { options };
}

export async function verifyAuthentication(response: unknown, config: WebAuthnConfig) {
  const client = redis();
  if (!client) return { error: "Passkey login is not configured" as const };
  const parsed = response as { id?: string; response?: { clientDataJSON?: string } };
  const clientData = parsed.response?.clientDataJSON;
  const credential = (await getCredentials()).find((item) => item.id === parsed.id);
  if (!clientData || !credential) return { error: "Passkey could not be verified" as const };
  const challenge = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
  const expected = await client.get<string>(`speedzone:passkey:authentication:${challenge}`);
  if (!expected) return { error: "Passkey login expired" as const };
  const verification = await verifyAuthenticationResponse({ response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"], expectedChallenge: expected, expectedOrigin: config.origin, expectedRPID: config.rpID, credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports } });
  if (!verification.verified) return { error: "Passkey could not be verified" as const };
  await saveCredentials((await getCredentials()).map((item) => item.id === credential.id ? { ...item, counter: verification.authenticationInfo.newCounter } : item));
  await client.del(`speedzone:passkey:authentication:${challenge}`);
  return { verified: true };
}

export const acceptedPasskeyTypes = "Platform passkeys (Touch ID, Face ID, Windows Hello, Android screen lock) and roaming FIDO2 security keys (USB, NFC, or Bluetooth). Passwords, SMS codes, OTPs, and magic links are not passkeys.";
export { createAdminSession } from "@/lib/admin-auth";
