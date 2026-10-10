import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "@upstash/redis";

export type CredentialAction = "add" | "delete";
export type SessionContext = {
  sessionKey: string;
  generationKey: string;
  generation: string;
  epochKey: string;
  epoch: number;
  policy: { field: "purpose" | "level"; value: "setup" | "passkey" | "mfa"; absoluteMs: number; idleMs: number };
};
export const sessionGuardLua = `
local function liveSession(key, generationKey, epochKey, now, policy)
  local raw=redis.call('GET',key); local generation=redis.call('GET',generationKey); local epoch=redis.call('GET',epochKey)
  if not raw or not generation or not epoch then return false end
  local ok,s=pcall(cjson.decode,raw); if not ok or type(s)~='table' then return false end
  if s.generation~=generation or tostring(s.credentialEpoch or s.epoch)~=epoch or s[policy.field]~=policy.value then return false end
  if type(s.createdAt)~='number' or type(s.lastSeenAt)~='number' or s.createdAt>now or s.lastSeenAt>now then return false end
  if policy.value=='mfa' and (type(s.passkeyVerifiedAt)~='number' or s.passkeyVerifiedAt<s.createdAt or s.passkeyVerifiedAt>now) then return false end
  return now-s.createdAt<policy.absoluteMs and now-s.lastSeenAt<policy.idleMs
end
local function actionGrant(key, sessionKey, epoch, action, target, now)
  local raw=redis.call('GET',key); if not raw then return false end
  local ok,g=pcall(cjson.decode,raw); if not ok or type(g)~='table' then return false end
  local sessionRaw=redis.call('GET',sessionKey); if not sessionRaw then return false end
  local valid,s=pcall(cjson.decode,sessionRaw); if not valid or type(s)~='table' or type(g.generation)~='string' or g.generation~=s.generation then return false end
  return g.sessionKey==sessionKey and tostring(g.epoch)==epoch and g.action==action and g.target==target
    and type(g.verifiedAt)=='number' and g.verifiedAt<=now and type(g.expiresAt)=='number' and now<g.expiresAt and now-g.verifiedAt<300000
end`;

export const rotateOtherSessionsLua = `
local keep=cjson.decode(redis.call('GET',KEYS[3]))
keep.generation=ARGV[7]; keep.lastSeenAt=now
redis.call('SET',KEYS[4],ARGV[7])
local policy=cjson.decode(ARGV[5]); local remaining=math.max(1,math.ceil((policy.absoluteMs-(now-keep.createdAt))/1000))
redis.call('SET',KEYS[3],cjson.encode(keep),'EX',remaining)`;

export function credentialGrantKey(prefix: string, token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return `${prefix}${createHash("sha256").update(token).digest("hex")}`;
}

export async function issueCredentialGrant(redis: Redis, prefix: string, context: SessionContext, action: CredentialAction, target: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await redis.set(credentialGrantKey(prefix, token)!, {
    sessionKey: context.sessionKey, generation: context.generation, epoch: context.epoch, action, target, verifiedAt: now, expiresAt: now + 300_000,
  }, { ex: 300, nx: true });
  return token;
}
