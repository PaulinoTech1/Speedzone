import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { privateHeaders, validateSecuritySession } from "../../../lib/auth";
import { enforceRateLimit } from "../../../lib/rate-limit";

export async function POST(request:Request){
  if(!await validateSecuritySession(request))return NextResponse.json({error:"Unauthorized"},{status:401,headers:privateHeaders});
  const rate=await enforceRateLimit(request,"delivery-test",2,900);if(!rate.allowed)return NextResponse.json({error:"Too many tests"},{status:429,headers:{...privateHeaders,"Retry-After":String(rate.retryAfter)}});
  const target=process.env.SECURITY_TEST_TARGET_URL?.trim();const secret=process.env.SECURITY_CONSOLE_TEST_SECRET?.trim();if(!target||!secret)return NextResponse.json({error:"Delivery test is not configured"},{status:503,headers:privateHeaders});
  const timestamp=String(Date.now());const nonce=randomUUID();const signature=createHmac("sha256",secret).update(`${timestamp}.${nonce}`).digest("hex");
  try{const upstream=await fetch(target,{method:"POST",headers:{"x-speedzone-timestamp":timestamp,"x-speedzone-nonce":nonce,"x-speedzone-signature":signature},cache:"no-store",signal:AbortSignal.timeout(7000)});const data=await upstream.json().catch(()=>({}));return NextResponse.json({httpStatus:data.status??upstream.status,delivered:Boolean(data.delivered),reference:data.reference??null},{status:upstream.ok?200:502,headers:privateHeaders})}catch{return NextResponse.json({error:"Delivery test target unavailable"},{status:502,headers:privateHeaders})}
}
