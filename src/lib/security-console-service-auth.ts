import { createHmac, timingSafeEqual } from "node:crypto";

export function securityConsoleSignature(secret:string,timestamp:string,method:string,path:string){return createHmac("sha256",secret).update(`${timestamp}\n${method.toUpperCase()}\n${path}`).digest("base64url")}
export function authorizeSecurityConsoleRequest(request:Request){
  const secret=process.env.SECURITY_CONSOLE_SERVICE_SECRET?.trim();if(!secret||secret.length<32)return false;
  const timestamp=request.headers.get("x-security-console-timestamp")||"";if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>60_000)return false;
  const supplied=request.headers.get("x-security-console-signature")||"";const url=new URL(request.url);const expected=securityConsoleSignature(secret,timestamp,request.method,`${url.pathname}${url.search}`);
  const a=Buffer.from(supplied);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
