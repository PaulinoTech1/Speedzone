import { createHmac } from "node:crypto";
export type VisibleBugReport={id:string;createdAt:string;category:string;title:string;details:string;page:string;contact:string;reference:string;status:string;severity:string;expiresAt:string}|{id:string;unreadable:true};
function signature(secret:string,timestamp:string,path:string){return createHmac("sha256",secret).update(`${timestamp}\nGET\n${path}`).digest("base64url")}
export async function readBugReports(cursor=0){
  const base=process.env.SPEEDZONE_SOURCE_URL?.trim();const secret=process.env.SECURITY_CONSOLE_SERVICE_SECRET?.trim();if(!base||!secret||secret.length<32)throw new Error("Site report source configuration is incomplete");
  const path=`/api/internal/security-console/reports?cursor=${cursor}`;const timestamp=String(Date.now());const response=await fetch(new URL(path,base),{headers:{"x-security-console-timestamp":timestamp,"x-security-console-signature":signature(secret,timestamp,path)},cache:"no-store",signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Site report source rejected the request (${response.status})`);return response.json() as Promise<{reports:VisibleBugReport[];nextCursor:number|null}>;
}
