import "server-only";

import type { NextResponse } from "next/server";

export const cookieNames = {
  preAuth: "__Host-sz-preauth",
  bootstrap: "__Host-sz-bootstrap",
  session: "__Host-sz-session",
  ceremony: "__Host-sz-ceremony",
  csrf: "__Host-sz-csrf-seed",
  stepUp: "__Host-sz-stepup",
  passwordStepUp: "__Host-sz-stepup-password",
  recovery: "__Host-sz-recovery",
} as const;

const baseCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};

export function setHostCookie(response: NextResponse, name: string, value: string, maxAge: number): void {
  response.cookies.set(name, value, { ...baseCookie, maxAge });
}

export function clearHostCookie(response: NextResponse, name: string): void {
  response.cookies.set(name, "", { ...baseCookie, expires: new Date(0), maxAge: 0 });
}

export function clearAuthenticationCookies(response: NextResponse): void {
  clearHostCookie(response, cookieNames.preAuth);
  clearHostCookie(response, cookieNames.bootstrap);
  clearHostCookie(response, cookieNames.session);
  clearHostCookie(response, cookieNames.ceremony);
  clearHostCookie(response, cookieNames.csrf);
  clearHostCookie(response, cookieNames.stepUp);
  clearHostCookie(response, cookieNames.passwordStepUp);
  clearHostCookie(response, cookieNames.recovery);
}
