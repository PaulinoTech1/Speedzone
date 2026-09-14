import { NextResponse } from "next/server";
import { readEvents } from "../../../lib/security-store";
import { isSecurityAuthenticated } from "../../../lib/security-auth";
export const dynamic = "force-dynamic";
export async function GET() { if (!(await isSecurityAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } }); try { return NextResponse.json({ events: await readEvents() }, { headers: { "Cache-Control": "no-store" } }); } catch { return NextResponse.json({ error: "Security event storage unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); } }
