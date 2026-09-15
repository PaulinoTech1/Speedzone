import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type CredentialDeviceType,
} from "@simplewebauthn/server";
import { validateSecuritySession } from "./auth";
import { currentCredentialEpoch } from "./password";
import { getSecurityRedis } from "./redis";

const rpName = "SpeedZone Security Console";
export type WebAuthnConfig = { rpID: string; origin: string };
const userID = "speedzone-security-console";
const challengeTtl = 120;
const credentialsKey = "speedzone:security-console:passkeys:v1";
const legacyCredentialsKey = "speedzone:security-console:passkeys";
const challengePrefix = "speedzone:security-console:passkey:";
const epochKey = "speedzone:security-console:credential-epoch:v1";
export const NO_ESTABLISHED_PASSKEY = "No established Security Console passkey is available. Console access is locked until credential recovery is performed.";

type StoredCredential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  name: string;
  credentialEpoch: number;
};
type ChallengeRecord = { challenge: string; credentialEpoch: number; createdAt: number };

export function getWebAuthnConfig(headers: Headers): WebAuthnConfig {
  const mounted = process.env.NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH === "/Security_Console";
  const configuredRpID = ((mounted && process.env.EMBEDDED_SECURITY_WEBAUTHN_RP_ID) || process.env.SECURITY_WEBAUTHN_RP_ID)?.trim();
  const configuredOrigin = ((mounted && process.env.EMBEDDED_SECURITY_WEBAUTHN_ORIGIN) || process.env.SECURITY_WEBAUTHN_ORIGIN)?.trim();
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim() || "localhost:3000";
  const rpID = configuredRpID || host.split(":")[0] || "localhost";
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return { rpID, origin: configuredOrigin || `${protocol}://${host}` };
}
function redis() { return getSecurityRedis(); }
function challengeKey(kind: "registration" | "authentication", challenge: string) { return `${challengePrefix}${kind}:${challenge}`; }
function isStoredCredential(item: unknown): item is StoredCredential {
  if (!item || typeof item !== "object") return false;
  const credential = item as StoredCredential;
  return typeof credential.id === "string" && typeof credential.publicKey === "string" && typeof credential.counter === "number"
    && Number.isSafeInteger(credential.credentialEpoch) && credential.credentialEpoch > 0;
}
function isUsableCredential(item: StoredCredential, epoch: number) {
  return item.credentialEpoch === epoch;
}
async function getCredentials() {
  const client = redis();
  if (!client) return null;
  const value = await client.get<unknown>(credentialsKey);
  if (value == null) return [];
  return Array.isArray(value) && value.every(isStoredCredential) ? value : null;
}
function usable(credentials: StoredCredential[], epoch: number) {
  return credentials.filter((item) => isUsableCredential(item, epoch));
}
async function getChallenge(kind: "registration" | "authentication", challenge: string) {
  const client = redis();
  if (!client) return null;
  const record = await client.get<ChallengeRecord>(challengeKey(kind, challenge));
  return record && record.challenge === challenge && Number.isSafeInteger(record.credentialEpoch) && record.credentialEpoch > 0 && typeof record.createdAt === "number" ? record : null;
}
const registrationCommitScript = `
local epoch = redis.call('GET', KEYS[2])
if not epoch or epoch ~= ARGV[1] then return 0 end
local raw = redis.call('GET', KEYS[3])
if not raw then return 0 end
local okChallenge, challengeRecord = pcall(cjson.decode, raw)
if not okChallenge or type(challengeRecord) ~= 'table' or challengeRecord.challenge ~= ARGV[2] then return 0 end
local credentials = {}
local existing = redis.call('GET', KEYS[1])
if existing then
  local ok, parsed = pcall(cjson.decode, existing)
  if not ok or type(parsed) ~= 'table' then return 0 end
  credentials = parsed
end
local currentCount = 0
for _, item in ipairs(credentials) do
  if type(item) ~= 'table' or type(item.id) ~= 'string' or type(item.publicKey) ~= 'string' or type(item.counter) ~= 'number' then return 0 end
  if tostring(item.credentialEpoch) == ARGV[1] then
    currentCount = currentCount + 1
  end
end
if ARGV[4] == 'managed' then
  if currentCount < 1 then return -2 end
  table.insert(credentials, cjson.decode(ARGV[3]))
  redis.call('SET', KEYS[1], cjson.encode(credentials))
  redis.call('DEL', KEYS[3])
  return 1
end
return 0
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
  await client.del(credentialsKey, legacyCredentialsKey);
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
  const [credentials, epoch] = await Promise.all([getCredentials(), currentCredentialEpoch()]);
  return Boolean(credentials && epoch !== null && usable(credentials, epoch).length);
}
export async function establishedPasskeyCount() {
  try {
    const [credentials, epoch] = await Promise.all([getCredentials(), currentCredentialEpoch()]);
    return credentials && epoch !== null ? usable(credentials, epoch).length : null;
  } catch { return null; }
}
export async function listPasskeys(): Promise<AdminPasskeySummary[]> {
  const [credentials, epoch] = await Promise.all([getCredentials(), currentCredentialEpoch()]);
  if (!credentials || epoch === null) return [];
  return usable(credentials, epoch).map(({ id, deviceType, backedUp, name }) => ({ id, deviceType, backedUp, name }));
}
export async function deletePasskey(id: string) {
  const client = redis(); const credentials = await getCredentials(); const epoch = await currentCredentialEpoch();
  if (!client || !credentials || epoch === null) return { deleted: false, reason: "Passkey storage unavailable" };
  const current = usable(credentials, epoch);
  if (!current.some((credential) => credential.id === id)) return { deleted: false, reason: "Passkey not found" };
  if (current.length <= 1) return { deleted: false, reason: "The final active passkey cannot be removed" };
  const next = credentials.filter((credential) => credential.id !== id || !isUsableCredential(credential, epoch));
  const result = await client.eval("local epoch = redis.call('GET', KEYS[2]); if not epoch or epoch ~= ARGV[1] then return 0 end; local current = redis.call('GET', KEYS[1]); if not current or current ~= ARGV[2] then return 0 end; local parsed = cjson.decode(current); local active = 0; for _, item in ipairs(parsed) do if tostring(item.credentialEpoch) == ARGV[1] then active = active + 1 end end; if active <= 1 then return -2 end; redis.call('SET', KEYS[1], ARGV[3]); return 1", [credentialsKey, epochKey], [String(epoch), JSON.stringify(credentials), JSON.stringify(next)]);
  return Number(result) === 1 ? { deleted: true } : { deleted: false, reason: Number(result) === -2 ? "The final active passkey cannot be removed" : "Passkey changed; retry" };
}
function storedFromVerification(info: NonNullable<Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]>, name: string, epoch: number, fallbackName: string): StoredCredential {
  const { credential, credentialDeviceType, credentialBackedUp } = info;
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports?.filter((transport): transport is AuthenticatorTransport =>
      transport === "ble" || transport === "hybrid" || transport === "internal" || transport === "nfc" || transport === "usb"),
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name.trim() ? name.trim().slice(0, 80) : fallbackName,
    credentialEpoch: epoch,
  };
}
export async function registrationOptions(config: WebAuthnConfig) {
  if (!await validateSecuritySession(undefined, "mfa")) return { error: "Verify your established passkey first" as const };
  const client = redis(); const credentials = await getCredentials(); const epoch = await currentCredentialEpoch();
  if (!client || !credentials || epoch === null) return { error: "Passkey storage is not configured" as const };
  const active = usable(credentials, epoch);
  if (!active.length) return { error: "Verify your established passkey first" as const };
  const options = await generateRegistrationOptions({ rpName, rpID: config.rpID, userName: "security@speedzonemotorsports", userDisplayName: "SpeedZone security operator", userID: new TextEncoder().encode(userID), attestationType: "none", excludeCredentials: active.map((item) => ({ id: item.id, transports: item.transports })), authenticatorSelection: { residentKey: "preferred", userVerification: "required" } });
  await client.set(challengeKey("registration", options.challenge), { challenge: options.challenge, credentialEpoch: epoch, createdAt: Date.now() } satisfies ChallengeRecord, { ex: challengeTtl });
  return { options };
}
export async function verifyRegistration(response: unknown, name: string, config: WebAuthnConfig) {
  if (!await validateSecuritySession(undefined, "mfa")) return { error: "Verify your established passkey first" as const };
  const client = redis(); if (!client) return { error: "Passkey storage is not configured" as const };
  try {
    const clientData = (response as { response?: { clientDataJSON?: string } }).response?.clientDataJSON;
    if (!clientData) return { error: "Invalid passkey response" as const };
    const challenge = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
    const record = await getChallenge("registration", challenge);
    if (!record) return { error: "Passkey setup expired" as const };
    const verification = await verifyRegistrationResponse({ response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"], expectedChallenge: record.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) return { error: "Passkey could not be verified" as const };
    const stored = storedFromVerification(verification.registrationInfo, name, record.credentialEpoch, "Unnamed passkey");
    const result = await client.eval(registrationCommitScript, [credentialsKey, epochKey, challengeKey("registration", challenge)], [String(record.credentialEpoch), record.challenge, JSON.stringify(stored), "managed"]);
    if (Number(result) === -2) return { error: "Verify your established passkey first" as const };
    return Number(result) === 1 ? { verified: true, credentialEpoch: record.credentialEpoch } : { error: "Passkey setup expired" as const };
  } catch { return { error: "Passkey could not be verified" as const }; }
}
export async function authenticationOptions(config: WebAuthnConfig) {
  const client = redis(); const credentials = await getCredentials(); const epoch = await currentCredentialEpoch();
  if (!client || !credentials || epoch === null) return { error: "Security passkey storage is unavailable. Please try again later.", status: 503 };
  const active = usable(credentials, epoch);
  if (!active.length) return { error: NO_ESTABLISHED_PASSKEY, status: 403 };
  const options = await generateAuthenticationOptions({ rpID: config.rpID, allowCredentials: active.map((item) => ({ id: item.id, transports: item.transports })), userVerification: "required" });
  await client.set(challengeKey("authentication", options.challenge), { challenge: options.challenge, credentialEpoch: epoch, createdAt: Date.now() } satisfies ChallengeRecord, { ex: challengeTtl });
  return { options };
}
export async function verifyAuthentication(response: unknown, config: WebAuthnConfig) {
  const client = redis(); const credentials = await getCredentials(); const epoch = await currentCredentialEpoch();
  if (!client || !credentials || epoch === null) return { error: "Passkey login is not configured" as const };
  try {
    const parsed = response as { id?: string; response?: { clientDataJSON?: string } };
    const clientData = parsed.response?.clientDataJSON;
    const credential = credentials.find((item) => item.id === parsed.id && isUsableCredential(item, epoch));
    if (!clientData || !credential) return { error: "Passkey could not be verified" as const };
    const challenge = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
    const record = await getChallenge("authentication", challenge);
    if (!record || record.credentialEpoch !== epoch) return { error: "Passkey login expired" as const };
    const verification = await verifyAuthenticationResponse({ response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"], expectedChallenge: record.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true, credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports } });
    if (!verification.verified) return { error: "Passkey could not be verified" as const };
    const result = await client.eval(counterCommitScript, [credentialsKey, epochKey, challengeKey("authentication", challenge)], [String(epoch), record.challenge, credential.id, String(credential.counter), String(verification.authenticationInfo.newCounter)]);
    return Number(result) === 1 ? { verified: true, credentialEpoch: epoch } : { error: "Passkey login expired" as const };
  } catch { return { error: "Passkey could not be verified" as const }; }
}
export const acceptedPasskeyTypes = "Platform passkeys (Touch ID, Face ID, Windows Hello, Android screen lock) and roaming FIDO2 security keys (USB, NFC, or Bluetooth). Passwords, SMS codes, OTPs, and magic links are not passkeys.";
