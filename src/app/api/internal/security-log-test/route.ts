import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/redis";
import { createSecurityEvent, deliverSecurityEvent, securityHeaders } from "@/lib/security-events";

function validSignature(request: Request, timestamp: string, nonce: string) {
  const secret=process.env.SECURITY_CONSOLE_TEST_SECRET?.trim(); const supplied=request.headers.get("x-speedzone-signature")??"";
  if(!secret||!/^\d{13}$/.test(timestamp)||!/^[0-9a-f-]{36}$/i.test(nonce)||Math.abs(Date.now()-Number(timestamp))>60_000)return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${nonce}`).digest("hex");
  const a=Buffer.from(supplied);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export async function POST(request: Request) {
  const timestamp=request.headers.get("x-speedzone-timestamp")??"";const nonce=request.headers.get("x-speedzone-nonce")??"";const requestId=`req_${randomUUID()}`;
  if(!validSignature(request,timestamp,nonce))return Response.json({error:"Unauthorized"},{status:401,headers:securityHeaders(requestId)});
  const redis=getRedis();if(!redis)return Response.json({error:"Unavailable"},{status:503,headers:securityHeaders(requestId)});
  const accepted=await redis.set(`speedzone:security-log-test:nonce:${nonce}`,"1",{nx:true,ex:120});if(!accepted)return Response.json({error:"Duplicate request"},{status:409,headers:securityHeaders(requestId)});
  const event=createSecurityEvent({requestId,event:"admin.login",outcome:"allowed",actor:"admin",route:"/api/internal/security-log-test",method:"POST",reason:"controlled-delivery-test",metadata:{synthetic:true}});
  const result=await deliverSecurityEvent(event);
  return Response.json({status:result.status,delivered:result.delivered,reference:event.id},{status:result.delivered?200:502,headers:securityHeaders(requestId)});
}
