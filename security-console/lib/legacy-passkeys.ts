import argon2 from "argon2";
import { getSecurityRedis } from "./redis";

// Only a verified password with matching credential epochs can bridge the
// original console store. A present v1 key (including []) is authoritative.
const migrateScript = `
local function equal(a,b)
  if type(a)~=type(b) then return false end
  if type(a)~='table' then return a==b end
  for key,value in pairs(a) do if not equal(value,b[key]) then return false end end
  for key in pairs(b) do if a[key]==nil then return false end end
  return true
end
if redis.call('EXISTS',KEYS[1])==1 then return 0 end
local raw=redis.call('GET',KEYS[2])
if not raw or not equal(cjson.decode(raw),cjson.decode(ARGV[1])) then return 0 end
if redis.call('GET',KEYS[3])~=ARGV[2] or redis.call('GET',KEYS[4])~=ARGV[2] then return 0 end
if redis.call('GET',KEYS[5])~=ARGV[3] or redis.call('GET',KEYS[6])~=ARGV[4] then return 0 end
redis.call('SET',KEYS[1],ARGV[5]); return 1`;

export async function migrateLegacyPasskeys(password: string, epoch: number, verifiedHash: string) {
  const redis = getSecurityRedis();
  if (!redis || await redis.get("speedzone:security-console:passkeys:v1") !== null) return;
  const legacy = await redis.get<unknown>("speedzone:security-console:passkeys");
  if (!Array.isArray(legacy) || !legacy.length || legacy.length > 100) return;
  if (!legacy.every(item => item && typeof item.id === "string" && /^[A-Za-z0-9_-]+$/.test(item.id)
    && typeof item.publicKey === "string" && /^[A-Za-z0-9_-]+$/.test(item.publicKey)
    && Number.isSafeInteger(item.counter) && item.counter >= 0
    && typeof item.name === "string" && typeof item.backedUp === "boolean"
    && ["singleDevice", "multiDevice"].includes(item.deviceType)
    && (item.transports === undefined || (Array.isArray(item.transports) && item.transports.every((t: unknown) => typeof t === "string"))))) return;
  const [legacyEpoch, legacyHash] = await Promise.all([
    redis.get<string>("speedzone:security-console:credential-epoch"),
    redis.get<string>("speedzone:security-console:password"),
  ]);
  if (String(legacyEpoch) !== String(epoch) || !legacyHash || !await argon2.verify(legacyHash, password)) return;
  await redis.eval(migrateScript, [
    "speedzone:security-console:passkeys:v1", "speedzone:security-console:passkeys",
    "speedzone:security-console:credential-epoch:v1", "speedzone:security-console:credential-epoch",
    "speedzone:security-console:credential:v1", "speedzone:security-console:password",
  ], [JSON.stringify(legacy), String(epoch), verifiedHash, legacyHash,
    JSON.stringify(legacy.map(item => ({ ...item, credentialEpoch: epoch })))]);
}
