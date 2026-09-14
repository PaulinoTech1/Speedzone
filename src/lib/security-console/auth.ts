import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getSecurityRedis } from "@/lib/security-console/redis";
import { currentCredentialEpoch } from "@/lib/security-console/password";

export const SECURITY_COOKIE = "__Host-speedzone_security";
const PREFIX = "speedzone:security-console:session:v1:";
const GENERATION_KEY = "speedzone:security-console:session-generation:v1";
const SESSION_INDEX_KEY = "speedzone:security-console:session-index:v1";
const SESSION_MAP_KEY = "speedzone:security-console:session-map:v1";
const ABSOLUTE_SECONDS = 60 * 60 * 4;
const IDLE_SECONDS = 15 * 60;
export type SessionLevel = "password" | "mfa";
type Session = { id:string;createdAt: number; lastSeenAt: number; epoch: number; generation: string; level: SessionLevel };
export type VisibleSecuritySession={id:string;createdAt:number;lastSeenAt:number;level:SessionLevel;current:boolean};
const createIndexedSessionScript=`redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]);redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]);redis.call('HSET',KEYS[3],ARGV[4],KEYS[1]);redis.call('EXPIRE',KEYS[2],ARGV[2]);redis.call('EXPIRE',KEYS[3],ARGV[2]);return 1`;

const validateScript = `
local raw=redis.call('GET',KEYS[1]); local generation=redis.call('GET',KEYS[2]); local epoch=redis.call('GET',KEYS[3]);
if not raw or not generation or not epoch then return 0 end
local session=cjson.decode(raw); local now=tonumber(ARGV[1]);
if session.generation~=generation or tostring(session.epoch)~=epoch or (ARGV[4]=='mfa' and session.level~='mfa') then return 0 end
if now-tonumber(session.createdAt)>=tonumber(ARGV[2]) or now-tonumber(session.lastSeenAt)>=tonumber(ARGV[3]) then redis.call('DEL',KEYS[1]); return 0 end
session.lastSeenAt=now; local remaining=math.max(1,math.ceil((tonumber(ARGV[2])-(now-tonumber(session.createdAt)))/1000)); redis.call('SET',KEYS[1],cjson.encode(session),'EX',remaining); return 1`;

function key(token: string) { return `${PREFIX}${createHash("sha256").update(token).digest("hex")}`; }
async function generation() {
  const redis = getSecurityRedis(); if (!redis) return null;
  const current = await redis.get<string>(GENERATION_KEY); if (current) return current;
  const next = randomBytes(16).toString("hex");
  return await redis.set(GENERATION_KEY, next, { nx: true }) ? next : redis.get<string>(GENERATION_KEY);
}
function tokenFromRequest(request?: Request) {
  const header = request?.headers.get("cookie");
  const raw = header?.split(";").map(v => v.trim()).find(v => v.startsWith(`${SECURITY_COOKIE}=`))?.slice(SECURITY_COOKIE.length + 1);
  return raw ? decodeURIComponent(raw.replace(/^"|"$/g, "")) : undefined;
}
async function token(request?: Request) { return tokenFromRequest(request) ?? (await cookies()).get(SECURITY_COOKIE)?.value; }

export async function createSecuritySession(epoch: number, level: SessionLevel) {
  const redis = getSecurityRedis(); const current = await generation();
  if (!redis || !current) return null;
  const value = randomBytes(32).toString("base64url"); const now = Date.now(); const id=randomUUID();
  const record: Session = { id,createdAt: now, lastSeenAt: now, epoch, generation: current, level };
  await redis.eval(createIndexedSessionScript,[key(value),SESSION_INDEX_KEY,SESSION_MAP_KEY],[JSON.stringify(record),ABSOLUTE_SECONDS,now,id]);
  return value;
}
export async function validateSecuritySession(request?: Request, required: SessionLevel = "mfa") {
  const value = await token(request); if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const redis = getSecurityRedis(); if (!redis) return false;
  try { return Number(await redis.eval(validateScript, [key(value), GENERATION_KEY, "speedzone:security-console:credential-epoch:v1"], [Date.now(), ABSOLUTE_SECONDS * 1000, IDLE_SECONDS * 1000, required])) === 1; }
  catch { return false; }
}
export async function revokeSecuritySession(request?: Request) { const value = await token(request); if (value) await getSecurityRedis()?.del(key(value)); }
export async function revokeAllSecuritySessions() { await getSecurityRedis()?.set(GENERATION_KEY, randomBytes(16).toString("hex")); }
export async function upgradeSecuritySession(request?: Request) { await revokeSecuritySession(request); const epoch = await currentCredentialEpoch(); return epoch ? createSecuritySession(epoch, "mfa") : null; }
export async function listSecuritySessions(request?:Request):Promise<VisibleSecuritySession[]>{
  const redis=getSecurityRedis();if(!redis)return[];const currentToken=await token(request);const currentKey=currentToken?key(currentToken):"";
  const [ids,currentGeneration,currentEpoch]=await Promise.all([redis.zrange<string[]>(SESSION_INDEX_KEY,0,-1,{rev:true}),redis.get<string>(GENERATION_KEY),redis.get<string>("speedzone:security-console:credential-epoch:v1")]);const visible:VisibleSecuritySession[]=[];const now=Date.now();
  for(const id of ids.slice(0,100)){const storedKey=await redis.hget<string>(SESSION_MAP_KEY,id);if(!storedKey)continue;const session=await redis.get<Session>(storedKey);if(!session||session.generation!==currentGeneration||String(session.epoch)!==currentEpoch||now-session.createdAt>=ABSOLUTE_SECONDS*1000||now-session.lastSeenAt>=IDLE_SECONDS*1000)continue;visible.push({id:session.id,createdAt:session.createdAt,lastSeenAt:session.lastSeenAt,level:session.level,current:storedKey===currentKey})}
  return visible;
}
export const securityCookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/", maxAge: ABSOLUTE_SECONDS, priority: "high" as const };
export const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" };
