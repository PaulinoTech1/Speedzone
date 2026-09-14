import { recordDiagnostic, withDiagnostics } from "@/lib/diagnostics";
import { get, put } from "@vercel/blob";
import { Resend } from "resend";
import { NextResponse } from "next/server";
import { getTestDriveFields, validateTestDriveFields } from "@/lib/test-drive-validation";
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

async function diagnosedPOST(request: Request) {
  const token = privateToken();
  if (!token) return NextResponse.json({ error: "Test-drive storage is not configured" }, { status: 503 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid form" }, { status: 400 }); }
  const requestId = String(form.get("requestId") || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return NextResponse.json({ error: "Invalid request reference. Refresh the form." }, { status: 400 });
  const fields = getTestDriveFields(form);
  const validationError = validateTestDriveFields(fields);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  let rateLimit;
  try {
    rateLimit = await limitTestDriveSubmission(getRequestKeys(request, fields.email, fields.phone));
  } catch (error) {
    console.error("[v0] test-drive rate limit failed", error);
    return NextResponse.json({ error: "Submissions are temporarily unavailable." }, { status: 503 });
  }
  if (!rateLimit.configured) {
    return NextResponse.json({ error: "Submissions are temporarily unavailable." }, { status: 503 });
  }
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
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
    return NextResponse.json(matches ? { ok: true, id: saved.id } : { error: "This reference was already used with different details. Refresh to start a new request." }, { status: matches ? 200 : 409 });
  }
  try {
    const existing = await existingResponse();
    if (existing) return existing;
    const encryptedPayload = await encryptTestDrivePayload(submission);
    await put(pathname, encryptedPayload, {
      access: "private",
      token,
      contentType: "application/octet-stream",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (error) {
    try { const existing = await existingResponse(); if (existing) return existing; } catch { /* retry remains safe */ }
    console.error("[v0] test-drive submission failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Unable to submit your request right now." }, { status: 500 });
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
      if (error) await recordDiagnostic("CUSTOMER_REQUEST_EMAIL_NOTIFY", 502);
    } else {
      await recordDiagnostic("CUSTOMER_REQUEST_EMAIL_NOTIFY", 503);
    }

  } catch {
    await recordDiagnostic("CUSTOMER_REQUEST_EMAIL_NOTIFY", 502);
  }

  await writeSecurityEvent({ ...securityRequestContext(request), event: "test-drive.submission", outcome: "allowed", actor: "anonymous", reason: "encrypted_submission_stored" });
  return NextResponse.json({ ok: true, id: submission.id }, { status: 201 });
}

export async function POST(request: Request) { return withDiagnostics("CUSTOMER_REQUEST_ACCEPT", () => diagnosedPOST(request)); }
