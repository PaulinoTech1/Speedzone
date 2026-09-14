import { NextRequest, NextResponse } from "next/server";
import { SECURITY_COOKIE } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const path=request.nextUrl.pathname;
  const publicPath=path==="/login"||path==="/setup"||path.startsWith("/api/auth/")||path.startsWith("/_next/")||path==="/favicon.ico";
  if(!publicPath&&!request.cookies.has(SECURITY_COOKIE)) return NextResponse.redirect(new URL("/login",request.url));
  return NextResponse.next();
}
export const config={matcher:["/((?!_next/static|_next/image).*)"]};
