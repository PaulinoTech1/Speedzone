import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type CredentialDeviceType,
} from "@simplewebauthn/server";
import { isAdmin, isAdminSetup } from "@/lib/admin-auth";
import { getCredentialEpoch, parseCredentialEpoch } from "@/lib/admin-recovery";
import { getRedis } from "@/lib/redis";

const rpName = "SpeedZone Motorsports";
export type WebAuthnConfig = { rpID: string; origin: string };
const userID = "speedzone-admin";
const challengeTtl = 120;
const credentialsKey = "speedzone:admin:passkeys";
const challengePrefix = "speedzone:passkey:";
const epochKey = "speedzone:admin-credential-epoch";

type StoredCredential = { id: string; publicKey: string; counter: number; transports?: AuthenticatorTransport[]; deviceType: CredentialDeviceType; backedUp: boolean; name: string; credentialEpoch: number };
type ChallengeRecord = { challenge: string; credentialEpoch: number; createdAt: number };

export function getWebAuthnConfig(headers: Headers): WebAuthnConfig {
  const configuredRpID = process.env.WEBAUTHN_RP_ID?.trim();
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN?.trim();
  if (configuredRpID && configuredOrigin) return { rpID: configuredRpID, origin: configuredOrigin };
  // Fail closed in production: the RP ID and origin bind a credential to the
  // site and must come from explicit configuration, never request headers.
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("WebAuthn RP ID/origin are not configured");
  }
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim() || "localhost:3000";
  const rpID = host.split(":")[0] || "localhost";
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return { rpID, origin: `${protocol}://${host}` };
}
function redis() { return getRedis(); }
function challengeKey(kind: "registration" | "authentication", challenge: string) { return `${challengePrefix}${kind}:${challenge}`; }
async function getCredentials() {
  const client = redis();
  if (!client) return null;
  const value = await client.get<StoredCredential[]>(credentialsKey);
  if (!value) return [];
  return Array.isArray(value) && value.every((item) => item && typeof item.id === "string" && typeof item.publicKey === "string" && typeof item.counter === "number" && parseCredentialEpoch(item.credentialEpoch) !== null) ? value : null;
}
async function getChallenge(kind: "registration" | "authentication", challenge: string) {
  const client = redis();
  if (!client) return null;
  const record = await client.get<ChallengeRecord>(challengeKey(kind, challenge));
  return record && record.challenge === challenge && parseCredentialEpoch(record.credentialEpoch) !== null && typeof record.createdAt === "number" ? record : null;
}
const registrationCommitScript = `
local epoch = redis.call('GET', KEYS[2])
if not epoch or epoch ~= ARGV[1] then return 0 end
local raw = redis.call('GET', KEYS[3])
local challenge = raw and cjson.decode(raw).challenge
if not challenge or challenge ~= ARGV[2] then return 0 end
local existing = redis.call('GET', KEYS[1])
local credentials = existing and cjson.decode(existing) or {}
local currentCount = 0
for _, item in ipairs(credentials) do
  if tostring(item.credentialEpoch) == ARGV[1] then currentCount = currentCount + 1 end
end
if ARGV[4] == 'initial' and currentCount > 0 then return -2 end
table.insert(credentials, cjson.decode(ARGV[3]))
redis.call('SET', KEYS[1], cjson.encode(credentials))
redis.call('DEL', KEYS[3])
return 1
`;
const counterCommitScript = `
local epoch = redis.call('GET', KEYS[2])
if not epoch or epoch ~= ARGV[1] then return 0 end
local rawChallenge = redis.call('GET', KEYS[3])
local challenge = rawChallenge and cjson.decode(rawChallenge).challenge
if not challenge or challenge ~= ARGV[2] then return 0 end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local credentials = cjson.decode(raw)
local found = false
for _, item in ipairs(credentials) do
  if item.id == ARGV[3] and tostring(item.credentialEpoch) == ARGV[1] and tonumber(item.counter) == tonumber(ARGV[4]) then
    item.counter = tonumber(ARGV[5])
    found = true
  end
end
if not found then return 0 end
redis.call('SET', KEYS[1], cjson.encode(credentials))
redis.call('DEL', KEYS[3])
return 1
`;
export async function revokeAllPasskeysAndChallenges() {
  const client = redis();
  if (!client) return false;
  await client.del(credentialsKey);
  let cursor = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, { match: `${challengePrefix}*`, count: 100 });
    cursor = Number(nextCursor);
    if (keys.length) await client.del(...keys);
  } while (cursor !== 0);
  return true;
}
export type AdminPasskeySummary = { id: string; deviceType: string; backedUp: boolean; name: string };
export async function hasCurrentPasskey() {
  const [credentials, epoch] = await Promise.all([getCredentials(), getCredentialEpoch()]);
  return credentials?.some((credential) => credential.credentialEpoch === epoch) ?? false;
}
export async function listPasskeys(): Promise<AdminPasskeySummary[]> { return (await getCredentials() ?? []).map(({ id, deviceType, backedUp, name }) => ({ id, deviceType, backedUp, name })); }
export async function deletePasskey(id: string) {
  const client = redis(); const credentials = await getCredentials(); const epoch = await getCredentialEpoch();
  if (!client || !credentials || epoch === null) return { deleted: false, reason: "Passkey storage unavailable" };
  if (!credentials.some((credential) => credential.id === id)) return { deleted: false, reason: "Passkey not found" };
  const current = credentials.filter((credential) => credential.credentialEpoch === epoch);
  if (current.length <= 1 && current.some((credential) => credential.id === id)) return { deleted: false, reason: "The final active passkey cannot be removed" };
  const next = credentials.filter((credential) => credential.id !== id);
  const result = await client.eval("local epoch = redis.call('GET', KEYS[2]); if not epoch or epoch ~= ARGV[1] then return 0 end; local current = redis.call('GET', KEYS[1]); if not current or current ~= ARGV[2] then return 0 end; local parsed = cjson.decode(current); local active = 0; for _, item in ipairs(parsed) do if tostring(item.credentialEpoch) == ARGV[1] then active = active + 1 end end; if active <= 1 then return -2 end; redis.call('SET', KEYS[1], ARGV[3]); return 1", [credentialsKey, epochKey], [String(epoch), JSON.stringify(credentials), JSON.stringify(next)]);
  return Number(result) === 1 ? { deleted: true } : { deleted: false, reason: Number(result) === -2 ? "The final active passkey cannot be removed" : "Passkey changed; retry" };
}
export async function registrationOptions(config: WebAuthnConfig) {
  const admin = await isAdmin();
  if (!admin && !(await isAdminSetup())) return { error: "Unauthorized" as const };
  if (!admin && await hasCurrentPasskey()) return { error: "Passkey enrollment is already complete" as const };
  const client = redis(); const credentials = await getCredentials(); const epoch = await getCredentialEpoch();
  if (!client || !credentials || epoch === null) return { error: "Passkey storage is not configured" as const };
  const options = await generateRegistrationOptions({ rpName, rpID: config.rpID, userName: "admin@speedzonemotorsports", userDisplayName: "SpeedZone admin", userID: new TextEncoder().encode(userID), attestationType: "none", excludeCredentials: credentials.filter((item) => item.credentialEpoch === epoch).map((item) => ({ id: item.id, transports: item.transports })), authenticatorSelection: { residentKey: "preferred", userVerification: "required" } });
  await client.set(challengeKey("registration", options.challenge), { challenge: options.challenge, credentialEpoch: epoch, createdAt: Date.now() } satisfies ChallengeRecord, { ex: challengeTtl });
  return { options };
}
export async function verifyRegistration(response: unknown, name: string, config: WebAuthnConfig) {
  const admin = await isAdmin();
  if (!admin && !(await isAdminSetup())) return { error: "Unauthorized" as const };
  if (!admin && await hasCurrentPasskey()) return { error: "Passkey enrollment is already complete" as const };
  const client = redis(); if (!client) return { error: "Passkey storage is not configured" as const };
  try {
    const clientData = (response as { response?: { clientDataJSON?: string } }).response?.clientDataJSON;
    if (!clientData) return { error: "Invalid passkey response" as const };
    const challenge = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
    const record = await getChallenge("registration", challenge);
    if (!record) return { error: "Passkey setup expired" as const };
    const verification = await verifyRegistrationResponse({ response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"], expectedChallenge: record.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID });
    if (!verification.verified || !verification.registrationInfo) return { error: "Passkey could not be verified" as const };
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const stored: StoredCredential = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, deviceType: credentialDeviceType, backedUp: credentialBackedUp, name: name || "Unnamed passkey", credentialEpoch: record.credentialEpoch };
    const result = await client.eval(registrationCommitScript, [credentialsKey, epochKey, challengeKey("registration", challenge)], [String(record.credentialEpoch), record.challenge, JSON.stringify(stored), admin ? "managed" : "initial"]);
    if (Number(result) === -2) return { error: "Passkey enrollment is already complete" as const };
    return Number(result) === 1 ? { verified: true, credentialEpoch: record.credentialEpoch } : { error: "Passkey setup expired" as const };
  } catch { return { error: "Passkey could not be verified" as const }; }
}
export async function authenticationOptions(config: WebAuthnConfig) {
  const client = redis(); const credentials = await getCredentials(); const epoch = await getCredentialEpoch();
  if (!client || !credentials || epoch === null) return { error: "Passkey login is not configured" as const };
  const options = await generateAuthenticationOptions({ rpID: config.rpID, allowCredentials: credentials.filter((item) => item.credentialEpoch === epoch).map((item) => ({ id: item.id, transports: item.transports })), userVerification: "required" });
  await client.set(challengeKey("authentication", options.challenge), { challenge: options.challenge, credentialEpoch: epoch, createdAt: Date.now() } satisfies ChallengeRecord, { ex: challengeTtl });
  return { options };
}
export async function verifyAuthentication(response: unknown, config: WebAuthnConfig) {
  const client = redis(); const credentials = await getCredentials(); const epoch = await getCredentialEpoch();
  if (!client || !credentials || epoch === null) return { error: "Passkey login is not configured" as const };
  try {
    const parsed = response as { id?: string; response?: { clientDataJSON?: string } };
    const clientData = parsed.response?.clientDataJSON;
    const credential = credentials.find((item) => item.id === parsed.id && item.credentialEpoch === epoch);
    if (!clientData || !credential) return { error: "Passkey could not be verified" as const };
    const challenge = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
    const record = await getChallenge("authentication", challenge);
    if (!record || record.credentialEpoch !== epoch) return { error: "Passkey login expired" as const };
    const verification = await verifyAuthenticationResponse({ response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"], expectedChallenge: record.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports } });
    if (!verification.verified) return { error: "Passkey could not be verified" as const };
    const result = await client.eval(counterCommitScript, [credentialsKey, epochKey, challengeKey("authentication", challenge)], [String(epoch), record.challenge, credential.id, String(credential.counter), String(verification.authenticationInfo.newCounter)]);
    return Number(result) === 1 ? { verified: true, credentialEpoch: epoch } : { error: "Passkey login expired" as const };
  } catch { return { error: "Passkey could not be verified" as const }; }
}
export const acceptedPasskeyTypes = "Platform passkeys (Touch ID, Face ID, Windows Hello, Android screen lock) and roaming FIDO2 security keys (USB, NFC, or Bluetooth). Passwords, SMS codes, OTPs, and magic links are not passkeys.";
