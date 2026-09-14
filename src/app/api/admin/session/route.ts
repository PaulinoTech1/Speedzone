import { withDiagnostics } from "@/lib/diagnostics";
import { NextResponse } from "next/server";
import { isAdmin, isAdminSetup, privateResponseHeaders } from "@/lib/admin-auth";
async function diagnosedGET() {
  const state = await isAdmin() ? "authenticated" : await isAdminSetup() ? "setup" : "signed-out";
  return NextResponse.json({ state }, { headers: privateResponseHeaders() });
}

export async function GET() { return withDiagnostics("ADMIN_SESSION_RESOLVE", () => diagnosedGET()); }
