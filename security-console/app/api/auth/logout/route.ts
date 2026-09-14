import { NextResponse } from "next/server";
import { privateHeaders, revokeSecuritySession, SECURITY_COOKIE, securityCookieOptions } from "@/lib/auth";

export async function POST(request: Request) {
  await revokeSecuritySession(request);
  const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
  response.cookies.set(SECURITY_COOKIE, "", { ...securityCookieOptions, maxAge: 0 }); return response;
}
