import { NextResponse } from "next/server";
import { privateHeaders, revokeSecuritySession, SECURITY_COOKIE, securityCookieOptions } from "@/lib/auth";
import { recordConsoleAudit } from "@/lib/console-audit";

export async function POST(request: Request) {
  await revokeSecuritySession(request);
  await recordConsoleAudit(request,"console.logout","allowed","session_revoked");
  const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
  response.cookies.set(SECURITY_COOKIE, "", { ...securityCookieOptions, maxAge: 0 }); return response;
}
