"use client";

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function rememberCsrfToken(token: string): void {
  if (!token || token.length > 8192) {
    throw new AdminApiError(
      "The server returned invalid request protection",
      500,
      "INVALID_CSRF_TOKEN",
    );
  }
  csrfToken = token;
}

export function clearClientSecurityState(): void {
  csrfToken = null;
}

export async function getCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const response = await fetch("/api/admin/csrf", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = (await response.json()) as { csrfToken?: string } & ApiErrorBody;
  if (!response.ok || !body.csrfToken) {
    throw new AdminApiError(
      body.error?.message ?? "Could not initialize request protection",
      response.status,
      body.error?.code,
    );
  }
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function adminFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retryExpiredCsrf = true,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const changesState = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (changesState) headers.set("x-csrf-token", await getCsrfToken());

  const response = await fetch(path, {
    ...init,
    method,
    body,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const parsed = contentType.includes("application/json")
    ? ((await response.json()) as T & ApiErrorBody)
    : ({} as T & ApiErrorBody);
  if (!response.ok) {
    if (
      retryExpiredCsrf &&
      changesState &&
      response.status === 403 &&
      parsed.error?.code === "REQUEST_REJECTED"
    ) {
      csrfToken = null;
      await getCsrfToken(true);
      return adminFetch<T>(path, init, false);
    }
    if (response.status === 401) clearClientSecurityState();
    throw new AdminApiError(
      parsed.error?.message ?? "The request could not be completed",
      response.status,
      parsed.error?.code,
    );
  }
  return parsed;
}
