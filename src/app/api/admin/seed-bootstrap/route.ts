import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "better-auth/crypto";

// TEMPORARY hash-only helper for one-time admin seeding.
// Reads SEED_ADMIN_PASSWORD from the app runtime (the only place it exists) and
// returns the one-way scrypt hash so it can be inserted into the Better Auth
// account row via the Neon MCP. Loopback-gated; deleted immediately after use.
export async function POST(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const isLoopback = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  if (!isLoopback) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const password = process.env.SEED_ADMIN_PASSWORD;
  const email = process.env.ADMIN_ID;
  if (!password) {
    return NextResponse.json({ ok: false, error: "SEED_ADMIN_PASSWORD not set" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "ADMIN_ID not set" }, { status: 400 });
  }
  if (password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { ok: false, error: `SEED_ADMIN_PASSWORD length ${password.length} is outside Better Auth's 8-128 range` },
      { status: 400 },
    );
  }

  const hash = await hashPassword(password);
  return NextResponse.json({ ok: true, email: email.toLowerCase(), hash });
}
