import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getSecurityRedis } from "@/lib/redis";

const INDEX_KEY="speedzone:security-console:audit:v1";
export type ConsoleAuditEvent={id:string;occurredAt:string;event:string;outcome:"allowed"|"denied"|"unavailable";reason:string;networkFingerprint?:string;country?:string;userAgentFamily?:string};

function client(request:Request){
  const secret=(process.env.SECURITY_CONSOLE_IP_HASH_SECRET||process.env.SECURITY_IP_HASH_SECRET)?.trim();
  const forwarded=process.env.VERCEL?request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().toLowerCase():"local";
  const canonical=forwarded&&isIP(forwarded)?forwarded:forwarded==="local"?"local":"unknown";
  const networkFingerprint=secret&&secret.length>=32?createHmac("sha256",secret).update(canonical).digest("hex").slice(0,24):undefined;
  const country=/^[A-Za-z]{2}$/.test(request.headers.get("x-vercel-ip-country")||"")?request.headers.get("x-vercel-ip-country")!.toUpperCase():undefined;
  const ua=request.headers.get("user-agent")||"";
  const browser=/Edg\//.test(ua)?"Edge":/Chrome\//.test(ua)?"Chrome":/Firefox\//.test(ua)?"Firefox":/Safari\//.test(ua)?"Safari":"Other browser";
  const platform=/Windows/.test(ua)?"Windows":/Android/.test(ua)?"Android":/iPhone|iPad/.test(ua)?"iOS":/Macintosh|Mac OS X/.test(ua)?"macOS":/Linux/.test(ua)?"Linux":"Other platform";
  return {networkFingerprint,country,userAgentFamily:`${browser} / ${platform}`};
}

export async function recordConsoleAudit(request:Request,event:string,outcome:ConsoleAuditEvent["outcome"],reason:string){
  const redis=getSecurityRedis();if(!redis)return;
  const record:ConsoleAuditEvent={id:randomUUID(),occurredAt:new Date().toISOString(),event,outcome,reason,...client(request)};
  try{await redis.eval("redis.call('LPUSH',KEYS[1],ARGV[1]);redis.call('LTRIM',KEYS[1],0,499);redis.call('EXPIRE',KEYS[1],2592000);return 1",[INDEX_KEY],[JSON.stringify(record)])}catch{/* authentication must not depend on audit persistence */}
}
export async function readConsoleAudit(limit=100){const redis=getSecurityRedis();if(!redis)throw new Error("Console audit unavailable");const rows=await redis.lrange<string>(INDEX_KEY,0,Math.min(Math.max(limit,1),500)-1);return rows.flatMap(row=>{try{return [JSON.parse(row) as ConsoleAuditEvent]}catch{return []}})}
