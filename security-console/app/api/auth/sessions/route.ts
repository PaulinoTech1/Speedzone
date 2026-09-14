import { NextResponse } from "next/server";
import { listSecuritySessions, privateHeaders, validateSecuritySession } from "@/lib/auth";
export async function GET(request:Request){if(!await validateSecuritySession(request,"mfa"))return NextResponse.json({error:"Unauthorized"},{status:401,headers:privateHeaders});return NextResponse.json({sessions:await listSecuritySessions(request)},{headers:privateHeaders})}
