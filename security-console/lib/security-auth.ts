import argon2 from "argon2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type CredentialDeviceType,
} from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { securityRedis } from "./security-store";

const COOKIE_NAME = "speedzone_security_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const SESSION_IDLE_TTL_SECONDS = 60 * 30;
const passwordKey = "speedzone:security-console:password";
const epochKey = "speedzone:security-console:credential-epoch";
const generationKey = "speedzone:security-console:session-generation";
const credentialsKey = "speedzone:security-console:passkeys";
const sessionPrefix = "speedzone:security-console:session:";
const challengePrefix = "speedzone:security-console:challenge:";
const challengeTtlSeconds = 120;
const userId = "speedzone-security-console";
const rpName = "SpeedZone Security Console";

type StoredCredential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  name: string;
};
type ChallengeRecord = { challenge: string; createdAt: number };
type SessionRecord = { createdAt: number; lastSeenAt: number; generation: string; credentialEpoch: number; factor: "password" | "mfa" };
export type WebAuthnConfig = { rpID: string; origin: string };

function sessionKey(token: string) { return `${sessionPrefix}${createHash("sha256").update(token).digest("hex")}`; }
function challengeKey(kind: "registration" | "authentication", challenge: string) { return `${challengePrefix}${kind}:${challenge}`; }
function configuredRedis() { return securityRedis(); }

export function securityWebAuthnConfig(headers: Headers): WebAuthnConfig {
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")?.trim() || "localhost:4190";
  const rpID = process.env.SECURITY_WEBAUTHN_RP_ID?.trim() || host.split(":")[0] || "localhost";
  const protocol = process.env.SECURITY_WEBAUTHN_ORIGIN?.trim() ? undefined : (headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") ? "http" : "https"));
  return { rpID, origin: process.env.SECURITY_WEBAUTHN_ORIGIN?.trim() || `${protocol}://${host}` };
}

async function credentialEpoch() {
  const redis = configuredRedis();
  if (!redis) return null;
  const value = await redis.get<string>(epochKey);
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

async function credentials() {
  const redis = configuredRedis();
  if (!redis) return null;
  const value = await redis.get<StoredCredential[]>(credentialsKey);
  return value === null ? [] : Array.isArray(value) ? value : null;
}

export async function hasSecurityPassword() {
  const redis = configuredRedis();
  return Boolean(redis && await redis.exists(passwordKey));
}

export async function bootstrapSecurityPassword(password: string, bootstrapToken: string) {
  const redis = configuredRedis();
  const configuredBootstrapToken = process.env.SECURITY_BOOTSTRAP_TOKEN || process.env.ADMIN_SECURITY_BOOTSTRAP_TOKEN;
  if (!redis || !configuredBootstrapToken || bootstrapToken !== configuredBootstrapToken) return { error: "Invalid bootstrap credentials" as const };
  if (password.length < 12) return { error: "Password must be at least 12 characters" as const };
  if (await redis.exists(passwordKey)) return { error: "Security password is already configured" as const };
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const generation = randomBytes(16).toString("hex");
  const result = await redis.eval("if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end; redis.call('SET', KEYS[1], ARGV[1]); redis.call('SET', KEYS[2], '1'); redis.call('SET', KEYS[3], ARGV[2]); return 1", [passwordKey, epochKey, generationKey], [hash, generation]);
  return Number(result) === 1 ? { authenticated: true } : { error: "Security password is already configured" as const };
}

export async function loginWithSecurityPassword(password: string) {
  const redis = configuredRedis();
  if (!redis) return { error: "Security Redis is not configured" as const };
  const hash = await redis.get<string>(passwordKey);
  if (!hash) return { error: "Security password is not configured" as const };
  try { return await argon2.verify(hash, password) ? { authenticated: true } : { error: "Invalid password" as const }; } catch { return { error: "Invalid password" as const }; }
}

export async function createSecuritySession(factor: "password" | "mfa" = "mfa") {
  const redis = configuredRedis();
  const epoch = await credentialEpoch();
  if (!redis || epoch === null) return null;
  let generation = await redis.get<string>(generationKey);
  if (!generation) { generation = randomBytes(16).toString("hex"); await redis.set(generationKey, generation, { nx: true }); generation = await redis.get<string>(generationKey) || generation; }
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await redis.set(sessionKey(token), { createdAt: now, lastSeenAt: now, generation, credentialEpoch: epoch, factor } satisfies SessionRecord, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function isSecurityAuthenticated() {
  return isSecuritySession("mfa");
}

export async function isSecurityPasswordAuthenticated() {
  return isSecuritySession("password", "mfa");
}

async function isSecuritySession(...factors: SessionRecord["factor"][]) {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const redis = configuredRedis();
  const epoch = await credentialEpoch();
  if (!redis || epoch === null) return false;
  const session = await redis.get<SessionRecord>(sessionKey(token));
  const generation = await redis.get<string>(generationKey);
  if (!session || !generation || session.generation !== generation || session.credentialEpoch !== epoch || !factors.includes(session.factor)) return false;
  const now = Date.now();
  if (now - session.createdAt >= SESSION_TTL_SECONDS * 1000 || now - session.lastSeenAt >= SESSION_IDLE_TTL_SECONDS * 1000) { await redis.del(sessionKey(token)); return false; }
  session.lastSeenAt = now;
  await redis.set(sessionKey(token), session, { ex: Math.max(1, Math.ceil((SESSION_TTL_SECONDS * 1000 - (now - session.createdAt)) / 1000)) });
  return true;
}

export function securitySessionCookie(token: string) { return { name: COOKIE_NAME, value: token, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_TTL_SECONDS }; }
export function clearSecuritySessionCookie() { return { name: COOKIE_NAME, value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 }; }

async function challenge(kind: "registration" | "authentication", value: string) {
  const redis = configuredRedis();
  if (!redis) return null;
  return redis.get<ChallengeRecord>(challengeKey(kind, value));
}

export async function registrationOptions(config: WebAuthnConfig) {
  if (!(await isSecurityAuthenticated())) return { error: "Unauthorized" as const };
  const redis = configuredRedis();
  const current = await credentials();
  if (!redis || !current) return { error: "Security Redis is not configured" as const };
  const options = await generateRegistrationOptions({ rpName, rpID: config.rpID, userName: "security@speedzonems.com", userDisplayName: "SpeedZone security administrator", userID: new TextEncoder().encode(userId), attestationType: "none", excludeCredentials: current.map((item) => ({ id: item.id, transports: item.transports })), authenticatorSelection: { residentKey: "preferred", userVerification: "required" } });
  await redis.set(challengeKey("registration", options.challenge), { challenge: options.challenge, createdAt: Date.now() } satisfies ChallengeRecord, { ex: challengeTtlSeconds });
  return { options };
}

export async function verifyRegistration(response: unknown, name: string, config: WebAuthnConfig) {
  if (!(await isSecurityAuthenticated())) return { error: "Unauthorized" as const };
  const redis = configuredRedis();
  if (!redis) return { error: "Security Redis is not configured" as const };
  try {
    const clientData = (response as { response?: { clientDataJSON?: string } }).response?.clientDataJSON;
    if (!clientData) return { error: "Invalid passkey response" as const };
    const challengeValue = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
    const record = await challenge("registration", challengeValue);
    if (!record) return { error: "Passkey registration expired" as const };
    const verification = await verifyRegistrationResponse({ response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"], expectedChallenge: record.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID });
    if (!verification.verified || !verification.registrationInfo) return { error: "Passkey could not be verified" as const };
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const stored: StoredCredential = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, deviceType: credentialDeviceType, backedUp: credentialBackedUp, name: name || "Unnamed passkey" };
    const result = await redis.eval("local raw = redis.call('GET', KEYS[1]); local credentials = raw and cjson.decode(raw) or {}; for _, item in ipairs(credentials) do if item.id == ARGV[1] then return 0 end end; table.insert(credentials, cjson.decode(ARGV[2])); redis.call('SET', KEYS[1], cjson.encode(credentials)); redis.call('DEL', KEYS[2]); return 1", [credentialsKey, challengeKey("registration", challengeValue)], [stored.id, JSON.stringify(stored)]);
    return Number(result) === 1 ? { verified: true } : { error: "Passkey is already registered" as const };
  } catch { return { error: "Passkey could not be verified" as const }; }
}

export async function authenticationOptions(config: WebAuthnConfig) {
  if (!(await isSecurityPasswordAuthenticated())) return { error: "Enter the security-console password before using a passkey" as const };
  const redis = configuredRedis();
  const current = await credentials();
  if (!redis || !current?.length) return { error: "Passkey login is not configured" as const };
  const options = await generateAuthenticationOptions({ rpID: config.rpID, allowCredentials: current.map((item) => ({ id: item.id, transports: item.transports })), userVerification: "required" });
  await redis.set(challengeKey("authentication", options.challenge), { challenge: options.challenge, createdAt: Date.now() } satisfies ChallengeRecord, { ex: challengeTtlSeconds });
  return { options };
}

export async function verifyAuthentication(response: unknown, config: WebAuthnConfig) {
  if (!(await isSecurityPasswordAuthenticated())) return { error: "Enter the security-console password before using a passkey" as const };
  const redis = configuredRedis();
  const current = await credentials();
  if (!redis || !current?.length) return { error: "Passkey login is not configured" as const };
  try {
    const parsed = response as { id?: string; response?: { clientDataJSON?: string } };
    const credential = current.find((item) => item.id === parsed.id);
    const clientData = parsed.response?.clientDataJSON;
    if (!credential || !clientData) return { error: "Passkey could not be verified" as const };
    const challengeValue = JSON.parse(Buffer.from(clientData, "base64url").toString()).challenge as string;
    const record = await challenge("authentication", challengeValue);
    if (!record) return { error: "Passkey login expired" as const };
    const verification = await verifyAuthenticationResponse({ response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"], expectedChallenge: record.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports } });
    if (!verification.verified) return { error: "Passkey could not be verified" as const };
    const result = await redis.eval("local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end; local credentials = cjson.decode(raw); for _, item in ipairs(credentials) do if item.id == ARGV[1] and tonumber(item.counter) == tonumber(ARGV[2]) then item.counter = tonumber(ARGV[3]); redis.call('SET', KEYS[1], cjson.encode(credentials)); redis.call('DEL', KEYS[2]); return 1 end end return 0", [credentialsKey, challengeKey("authentication", challengeValue)], [credential.id, String(credential.counter), String(verification.authenticationInfo.newCounter)]);
    return Number(result) === 1 ? { verified: true } : { error: "Passkey login expired" as const };
  } catch { return { error: "Passkey could not be verified" as const }; }
}

export { COOKIE_NAME };
