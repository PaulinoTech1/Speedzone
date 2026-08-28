import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";

import { constantTimeTextEqual } from "@/lib/server/crypto";
import {
  bootstrapEnrollmentRuntimePermitted,
  webAuthnConfig,
} from "@/lib/server/env";

export class RequestValidationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}

class InvalidJsonSyntaxError extends Error {}
class UnsafeJsonObjectError extends Error {}

const prototypePollutionKeys = new Set(["__proto__", "constructor", "prototype"]);

class DuplicateAwareJsonScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  scan(): void {
    this.skipWhitespace();
    this.scanValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) this.invalid();
  }

  private scanValue(depth = 0): void {
    if (depth > 32) throw new UnsafeJsonObjectError();
    const character = this.text[this.index];
    if (character === "{") return this.scanObject(depth);
    if (character === "[") return this.scanArray(depth);
    if (character === '"') {
      this.scanString();
      return;
    }
    if (character === "t") return this.scanLiteral("true");
    if (character === "f") return this.scanLiteral("false");
    if (character === "n") return this.scanLiteral("null");
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      this.scanNumber();
      return;
    }
    this.invalid();
  }

  private scanObject(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("}")) return;
    const keys = new Set<string>();
    while (true) {
      if (this.text[this.index] !== '"') this.invalid();
      const key = this.scanString();
      if (keys.has(key) || prototypePollutionKeys.has(key)) {
        throw new UnsafeJsonObjectError();
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.consume("}")) return;
      this.expect(",");
      this.skipWhitespace();
    }
  }

  private scanArray(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    while (true) {
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.consume("]")) return;
      this.expect(",");
      this.skipWhitespace();
    }
  }

  private scanString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          const value = JSON.parse(this.text.slice(start, this.index)) as unknown;
          if (typeof value !== "string") this.invalid();
          return value;
        } catch {
          this.invalid();
        }
      }
      if (character === "\\") {
        this.index += 2;
        if (this.index > this.text.length) this.invalid();
        continue;
      }
      if (character === undefined || character.charCodeAt(0) <= 0x1f) this.invalid();
      this.index += 1;
    }
    this.invalid();
  }

  private scanNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.index),
    );
    if (!match) this.invalid();
    this.index += match[0].length;
  }

  private scanLiteral(literal: "true" | "false" | "null"): void {
    if (!this.text.startsWith(literal, this.index)) this.invalid();
    this.index += literal.length;
  }

  private skipWhitespace(): void {
    while (true) {
      const character = this.text[this.index];
      if (
        character !== " " &&
        character !== "\t" &&
        character !== "\n" &&
        character !== "\r"
      ) {
        return;
      }
      this.index += 1;
    }
  }

  private consume(character: string): boolean {
    if (this.text[this.index] !== character) return false;
    this.index += 1;
    return true;
  }

  private expect(character: string): void {
    if (!this.consume(character)) this.invalid();
  }

  private invalid(): never {
    throw new InvalidJsonSyntaxError();
  }
}

function assertJsonContentType(request: NextRequest): void {
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  const validJsonType =
    /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      contentType,
    );
  if (!validJsonType) {
    throw new RequestValidationError(
      "Content-Type must be application/json",
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }
}

function assertDeclaredBodyLimit(request: NextRequest, maximumBytes: number): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const normalized = header.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RequestValidationError("Request body length is invalid");
  }
  const declared = Number(normalized);
  if (!Number.isSafeInteger(declared) || declared > maximumBytes) {
    throw new RequestValidationError("Request body is too large", 413, "BODY_TOO_LARGE");
  }
}

/**
 * Streams the body with an early-abort byte cap, rather than buffering first
 * and checking after: an oversized body is cancelled mid-stream instead of
 * being fully read into memory. Shared by the UTF-8 (JSON) and raw-binary
 * (photo upload) readers below.
 */
async function readBoundedBytes(request: NextRequest, maximumBytes: number): Promise<Uint8Array> {
  assertDeclaredBodyLimit(request, maximumBytes);
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The fixed validation response remains authoritative if cancellation fails.
        }
        throw new RequestValidationError("Request body is too large", 413, "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBoundedUtf8Body(request: NextRequest, maximumBytes: number): Promise<string> {
  const bytes = await readBoundedBytes(request, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestValidationError("Request body must be valid UTF-8 JSON");
  }
}

/** Raw-binary counterpart of `readBoundedUtf8Body`, for uploads rather than JSON. */
export async function readBoundedBinaryBody(request: NextRequest, maximumBytes: number): Promise<Buffer> {
  return Buffer.from(await readBoundedBytes(request, maximumBytes));
}

export function assertAllowedOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const { origins } = webAuthnConfig();
  if (!origin || !origins.some((allowed) => constantTimeTextEqual(allowed, origin))) {
    throw new RequestValidationError("Request rejected", 403, "REQUEST_REJECTED");
  }
}

/** Enforce the final, explicitly configured enrollment origin without Host trust. */
export function assertBootstrapEnrollmentRequest(request: NextRequest): void {
  if (!bootstrapEnrollmentRuntimePermitted()) {
    throw new RequestValidationError("Request rejected", 403, "REQUEST_REJECTED");
  }
  const expectedOrigin = webAuthnConfig().expectedOrigin;
  const requestOrigin = request.headers.get("origin");
  if (
    !expectedOrigin ||
    !requestOrigin ||
    !constantTimeTextEqual(expectedOrigin, requestOrigin)
  ) {
    throw new RequestValidationError("Request rejected", 403, "REQUEST_REJECTED");
  }
}

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: ZodType<T>,
  maximumBytes = 32_768,
): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new RequestValidationError("Request body is too large", 413, "BODY_TOO_LARGE");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new RequestValidationError("Request body is too large", 413, "BODY_TOO_LARGE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestValidationError("Request body must be valid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new RequestValidationError("Request validation failed", 422, "VALIDATION_FAILED");
  return result.data;
}

export async function parseStrictJsonBody<T>(
  request: NextRequest,
  schema: ZodType<T>,
  maximumBytes: number,
): Promise<T> {
  assertJsonContentType(request);
  const text = await readBoundedUtf8Body(request, maximumBytes);
  let parsed: unknown;
  try {
    new DuplicateAwareJsonScanner(text).scan();
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof UnsafeJsonObjectError) {
      throw new RequestValidationError("Request validation failed", 422, "VALIDATION_FAILED");
    }
    throw new RequestValidationError("Request body must be valid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new RequestValidationError("Request validation failed", 422, "VALIDATION_FAILED");
  }
  return result.data;
}

export function noStoreJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function genericAuthFailure(): NextResponse {
  return noStoreJson(
    { ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } },
    { status: 401 },
  );
}

export function requestErrorResponse(error: unknown): NextResponse {
  if (error instanceof RequestValidationError) {
    return noStoreJson(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return noStoreJson(
    { ok: false, error: { code: "SERVER_ERROR", message: "The request could not be completed" } },
    { status: 500 },
  );
}
