import { recordDiagnostic, withDiagnostics } from "@/lib/diagnostics";
import { get, put } from "@vercel/blob";
import { Resend } from "resend";
import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { validateTestDriveFields, type TestDriveFields } from "@/lib/test-drive-validation";
import { readTestDriveForm, TestDriveRequestError, validTestDriveOrigin } from "@/lib/test-drive-request";
import { getRequestKeys, limitTestDriveSubmission } from "@/lib/test-drive-rate-limit";
import { decryptTestDrivePayload, encryptTestDrivePayload } from "@/lib/test-drive-crypto";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

const privateToken = () => process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN;

export type TestDriveSubmission = {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  date: string;
  time: string;
  notes: string;
  createdAt: string;
};

// Failure attribution without customer data: the stage and the error class
// name (e.g. BlobAccessError) are enough to separate configuration faults
// from code faults in logs and the security console.
function errorClass(error: unknown) {
  const name = error instanceof Error ? error.name || error.constructor?.name : "UnknownError";
  return /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : "UnknownError";
}
async function reportFailure(request: Request, failureStage: string, errorName: string) {
  try {
    await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.submission", outcome: "failed", actor: "anonymous", reason: `${failureStage}_failed`, metadata: { failure_stage: failureStage, error_class: errorName } });
  } catch { /* telemetry is best effort */ }
}

// Every response from this endpoint is private and uncacheable.
const noStore = { "Cache-Control": "no-store" };
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...noStore, ...headers } });
}

async function diagnosedPOST(request: Request) {
  if (!validTestDriveOrigin(request)) return json({ error: "Please submit from the website form." }, 403);
  // BotID Basic (free). Enforced on Vercel deployments, where the challenge
  // rewrites exist; off Vercel (local/e2e) there is nothing to verify against.
  let bot = false;
  if (process.env.VERCEL) { try { bot = (await checkBotId()).isBot; } catch { bot = true; } }
  if (bot) return json({ error: "Automated submissions are not accepted. Reload the page and try again." }, 403);
  let requestId: string; let fields: TestDriveFields;
  try { ({ requestId, fields } = await readTestDriveForm(request)); }
  catch (error) { return json({ error: error instanceof TestDriveRequestError ? error.message : "Invalid form" }, error instanceof TestDriveRequestError ? error.status : 400); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return json({ error: "Invalid request reference. Refresh the form." }, 400);
  const validationError = validateTestDriveFields(fields);
  if (validationError) return json({ error: validationError }, 400);

  const token = privateToken();
  if (!token) return json({ error: "Test-drive storage is not configured" }, 503);

  let rateLimit;
  try {
    rateLimit = await limitTestDriveSubmission(getRequestKeys(request, fields.email, fields.phone));
  } catch (error) {
    console.error("[test-drive] contact protection failed", errorClass(error));
    await reportFailure(request, "contact_protection", errorClass(error));
    return json({ error: "Submissions are temporarily unavailable." }, 503);
  }
  if (!rateLimit.configured) {
    await reportFailure(request, "rate_limiter", "unavailable");
    return json({ error: "Submissions are temporarily unavailable." }, 503);
  }
  if (!rateLimit.success) {
    return json({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": String(rateLimit.retryAfter) });
  }

  const submission: TestDriveSubmission = {
    id: requestId,
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    vehicle: fields.vehicle,
    date: fields.date,
    time: fields.time,
    notes: fields.notes,
    createdAt: new Date().toISOString(),
  };

  const pathname = `test-drive/requests/${requestId}.enc`;
  async function existingResponse() {
    const existing = await get(pathname, { access: "private", token, useCache: false });
    if (!existing) return null;
    const saved = await decryptTestDrivePayload<TestDriveSubmission>(await new Response(existing.stream).text());
    const matches = Object.entries(fields).every(([key, value]) => saved[key as keyof TestDriveSubmission] === value);
    return json(matches ? { ok: true, id: saved.id } : { error: "This reference was already used with different details. Refresh to start a new request." }, matches ? 200 : 409);
  }
  let stage = "storage_read";
  try {
    const existing = await existingResponse();
    if (existing) return existing;
    stage = "encryption";
    const encryptedPayload = await encryptTestDrivePayload(submission);
    stage = "storage_write";
    await put(pathname, encryptedPayload, {
      access: "private",
      token,
      contentType: "application/octet-stream",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (error) {
    try { const existing = await existingResponse(); if (existing) return existing; } catch { /* retry remains safe */ }
    console.error("[test-drive] submission failed", stage, errorClass(error));
    await reportFailure(request, stage, errorClass(error));
    return json({ error: "Unable to submit your request right now." }, 500);
  }

  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailDomain = process.env.RESEND_EMAIL_DOMAIN;
    const recipient = process.env.TEST_DRIVE_NOTIFICATION_EMAIL;
    if (resendApiKey && emailDomain && recipient) {
      const resend = new Resend(resendApiKey);
      const { error } = await resend.emails.send(
        {
          from: `SpeedZone Motorsports <no-reply@${emailDomain}>`,
          to: [recipient],
          subject: "New test-drive request",
          text: [
            "A new test-drive request was submitted.",
            "",
            "Sign in to the website admin inbox to view the customer details.",
            `Submission ID: ${submission.id}`,
          ].join("\n"),
        },
        { idempotencyKey: `test-drive-submission/${submission.id}` },
      );
      if (error) {
        await recordDiagnostic("CUSTOMER_REQUEST_EMAIL_NOTIFY", 502);
        await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.notification", outcome: "failed", actor: "anonymous", reason: "provider_rejected", metadata: { submission_reference: submission.id } });
      } else {
        await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.notification", outcome: "allowed", actor: "anonymous", reason: "provider_accepted", metadata: { submission_reference: submission.id } });
      }
    } else {
      await recordDiagnostic("CUSTOMER_REQUEST_EMAIL_NOTIFY", 503);
      await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.notification", outcome: "unavailable", actor: "anonymous", reason: "provider_not_configured", metadata: { submission_reference: submission.id } });
    }

  } catch {
    await recordDiagnostic("CUSTOMER_REQUEST_EMAIL_NOTIFY", 502);
    await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.notification", outcome: "failed", actor: "anonymous", reason: "provider_unavailable", metadata: { submission_reference: submission.id } });
  }

  await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.submission", outcome: "allowed", actor: "anonymous", reason: "encrypted_submission_stored" });
  return json({ ok: true, id: submission.id }, 201);
}

export async function POST(request: Request) { return withDiagnostics("CUSTOMER_REQUEST_ACCEPT", () => diagnosedPOST(request)); }
