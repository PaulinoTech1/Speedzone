import { createHmac } from "node:crypto";
import { getRedis } from "@/lib/redis";

const WINDOW_SECONDS = 60;
const IP_LIMIT = 20;
const NETWORK_LIMIT = 60;
const GLOBAL_LIMIT = 300;
const OUTSTANDING_LIMIT = 2;
const SECRET = process.env.SPEEDZONE_ADMIN_PASSWORD || "speedzone-passkey-limiter";

const admitScript = `
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local ip = tonumber(redis.call('GET', KEYS[1]) or '0')
local network = tonumber(redis.call('GET', KEYS[2]) or '0')
local global = tonumber(redis.call('GET', KEYS[3]) or '0')
local outstanding = tonumber(redis.call('GET', KEYS[4]) or '0')
if ip >= tonumber(ARGV[3]) or network >= tonumber(ARGV[4]) or global >= tonumber(ARGV[5]) or outstanding >= tonumber(ARGV[6]) then return 0 end
for _, key in ipairs(KEYS) do redis.call('INCR', key); redis.call('EXPIRE', key, ttl) end
return 1
`;

function digest(value: string) {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function clientAddress(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  const value = forwarded || real || "unknown";
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return "unknown";
  return value;
}

function networkPrefix(address: string) {
  if (address.includes(".")) return address.split(".").slice(0, 3).join(".");
  if (address.includes(":")) return address.split(":").slice(0, 4).join(":");
  return address;
}

export async function admitAuthenticationOptions(address: string) {
  const redis = getRedis();
  if (!redis) return { configured: false, success: false, retryAfter: WINDOW_SECONDS };
  const suffix = String(Math.floor(Date.now() / 1000 / WINDOW_SECONDS));
  const keys = [
    `speedzone:passkey-options:ip:${digest(address)}:${suffix}`,
    `speedzone:passkey-options:network:${digest(networkPrefix(address))}:${suffix}`,
    `speedzone:passkey-options:global:${suffix}`,
    `speedzone:passkey-options:outstanding:${digest(address)}`,
  ];
  try {
    const result = await redis.eval(admitScript, keys, [String(Math.floor(Date.now() / 1000)), String(WINDOW_SECONDS * 2), String(IP_LIMIT), String(NETWORK_LIMIT), String(GLOBAL_LIMIT), String(OUTSTANDING_LIMIT)]);
    return { configured: true, success: Number(result) === 1, retryAfter: WINDOW_SECONDS };
  } catch {
    return { configured: false, success: false, retryAfter: WINDOW_SECONDS };
  }
}
