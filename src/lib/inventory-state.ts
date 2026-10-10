import { createHash } from "node:crypto";

export const inventoryStateKey = "speedzone:inventory:catalog:v2";
export const inventoryPhotoGraceMs = 24 * 60 * 60 * 1000;
export function canonicalInventoryPhotoUrl(url: string) {
  try { return new URL(url).href; } catch { return url; }
}
export function inventoryPhotoStateKey(url: string) {
  return `speedzone:inventory:photo-state:${createHash("sha256").update(canonicalInventoryPhotoUrl(url)).digest("hex")}`;
}

export const inventoryCommitScript = `
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local current=cjson.decode(raw)
if current.version~=2 or current.revision~=ARGV[1] then return 0 end
for i=2,#KEYS do
  local state=redis.call('GET',KEYS[i]); if state=='deleting' or state=='deleted' then return -1 end
end
redis.call('SET',KEYS[1],ARGV[2]); return 1`;

export const inventoryCleanupClaimScript = `
local raw=redis.call('GET',KEYS[1]); if not raw then return {} end
local current=cjson.decode(raw); if current.version~=2 or current.revision~=ARGV[1] then return {} end
local referenced={}
for _,vehicle in ipairs(current.vehicles) do for _,url in ipairs(vehicle.photos) do referenced[url]=true end end
local candidates=cjson.decode(ARGV[2]); local claimed={}
for i,url in ipairs(candidates) do
  local state=redis.call('GET',KEYS[i+1])
  if not referenced[url] and (not state or state=='deleting') then
    redis.call('SET',KEYS[i+1],'deleting'); table.insert(claimed,url)
  end
end
return claimed`;
