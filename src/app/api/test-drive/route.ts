import { put } from "@vercel/blob";
import { Resend } from "resend";
import { NextResponse } from "next/server";
import { getTestDriveFields, validateTestDriveFields } from "@/lib/test-drive-validation";
import { getRequestKeys, limitTestDriveSubmission } from "@/lib/test-drive-rate-limit";

const privateToken = () => process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

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

export async function POST(request: Request) {
  const token = privateToken();
  if (!token) return NextResponse.json({ error: "Test-drive storage is not configured" }, { status: 503 });

  const form = await request.formData();
  const fields = getTestDriveFields(form);
  const validationError = validateTestDriveFields(fields);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const turnstileToken = fields.turnstileToken;
  if (!turnstileToken || !process.env.TURNSTILE_SECRET_KEY) {
    return NextResponse.json({ error: "Unable to verify your request." }, { status: 400 });
  }
  const turnstileResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: turnstileToken }),
  });
  const turnstileResult = (await turnstileResponse.json()) as { success?: boolean };
  if (!turnstileResponse.ok || !turnstileResult.success) {
    return NextResponse.json({ error: "Unable to verify your request." }, { status: 400 });
  }

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
    id: crypto.randomUUID(),
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    vehicle: fields.vehicle,
    date: fields.date,
    time: fields.time,
    notes: fields.notes,
    createdAt: new Date().toISOString(),
  };

  try {
    await put(`test-drive/${submission.createdAt.slice(0, 10)}/${submission.id}.json`, JSON.stringify(submission), {
      access: "private",
      token,
      contentType: "application/json",
      addRandomSuffix: false,
    });

    const resendApiKey = process.env.RESEND_API_KEY;
    const emailDomain = process.env.RESEND_EMAIL_DOMAIN;
    if (resendApiKey && emailDomain) {
      const resend = new Resend(resendApiKey);
      const { error } = await resend.emails.send(
        {
          from: `SpeedZone Motorsports <no-reply@${emailDomain}>`,
          to: ["alex@paulinotech.com"],
          subject: `New test-drive request: ${submission.name}`,
          text: [
            "A new test-drive request was submitted.",
            "",
            `Name: ${submission.name}`,
            `Email: ${submission.email}`,
            `Phone: ${submission.phone}`,
            `Vehicle: ${submission.vehicle}`,
            `Date: ${submission.date}`,
            `Time: ${submission.time}`,
            `Notes: ${submission.notes || "None"}`,
            `Submission ID: ${submission.id}`,
          ].join("\\n"),
        },
        { idempotencyKey: `test-drive-submission/${submission.id}` },
      );
      if (error) console.error("[v0] test-drive notification failed", error.message);
    } else {
      console.error("[v0] test-drive notification is not configured");
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[v0] test-drive submission failed", error);
    return NextResponse.json({ error: "Unable to submit your request right now." }, { status: 500 });
  }
}
