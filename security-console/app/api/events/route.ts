import { NextResponse } from "next/server";
import { readEvents } from "../../../lib/security-store";
import { privateHeaders, validateSecuritySession } from "../../../lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { if(!await validateSecuritySession(request))return NextResponse.json({error:"Unauthorized"},{status:401,headers:privateHeaders});try { return NextResponse.json({ events: await readEvents() }, { headers: privateHeaders }); } catch { return NextResponse.json({ error: "Security event provider unavailable" }, { status: 503, headers: privateHeaders }); } }
