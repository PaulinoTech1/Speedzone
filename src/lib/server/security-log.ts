import "server-only";

import type { NextRequest } from "next/server";

import { hmacSha256 } from "@/lib/server/crypto";
import { tokenConfig } from "@/lib/server/env";

export type SecurityEventName =
  | "auth.password"
  | "auth.passkey"
  | "auth.bootstrap"
  | "auth.recovery"
  | "auth.logout"
  | "auth.session_revoked"
  | "passkey.added"
  | "passkey.deleted"
  | "inventory.created"
  | "inventory.updated"
  | "inventory.status"
  | "upload.authorized"
  | "upload.rejected"
  | "test_drive.submitted"
  | "trade_in.submitted"
  | "rate_limited";

type SecurityEvent = {
  event: SecurityEventName;
  outcome: "success" | "failure" | "blocked";
  requestId?: string;
  actorHash?: string;
  clientHash?: string;
  recordId?: string;
  reason?: string;
};

function safeHash(value: string): string {
  return hmacSha256(tokenConfig().hashKey, value).slice(0, 20);
}

export function clientSecurityHash(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return safeHash(`${forwarded}|${userAgent}`);
}

export function ipSecurityHash(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return safeHash(`ip:${forwarded}`);
}

export function ja4SecurityHash(request: NextRequest): string | null {
  const digest = request.headers.get("x-vercel-ja4-digest")?.trim();
  return digest ? safeHash(`ja4:${digest}`) : null;
}

export function actorSecurityHash(identifier: string): string {
  return safeHash(identifier);
}

export function logSecurityEvent(event: SecurityEvent): void {
  const record = {
    type: "speedzone.security",
    timestamp: new Date().toISOString(),
    ...event,
  };
  console.info(JSON.stringify(record));
}
