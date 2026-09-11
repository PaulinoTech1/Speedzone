import { NextResponse } from "next/server";
import { readEvents } from "../../../lib/security-store";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json({ events: await readEvents() }, { headers: { "Cache-Control": "no-store" } }); } catch { return NextResponse.json({ error: "Security event storage unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); } }
