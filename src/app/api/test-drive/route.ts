import { NextRequest } from "next/server";

import {
  testDriveRequestSchema,
  testDriveTimeSlotLabels,
  type TestDriveRequest,
} from "@/lib/domain/test-drive";
import { testDriveConfig } from "@/lib/server/env";
import { noStoreJson, parseStrictJsonBody, RequestValidationError } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { clientSecurityHash, logSecurityEvent } from "@/lib/server/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumBodyBytes = 8 * 1024;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function notificationEmail(request: TestDriveRequest): { text: string; html: string } {
  const rows: [string, string][] = [
    ["Full name", request.fullName],
    ["Email", request.email],
    ["Phone", request.phone],
    ["Vehicle of interest", request.vehicleOfInterest],
    ["Preferred date", request.preferredDate],
    ["Preferred time", testDriveTimeSlotLabels[request.preferredTime]],
  ];
  const comments = request.comments.trim() || "(none)";

  const text = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Comments:",
    comments,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;">
  <h2 style="margin:0 0 16px;color:#d9001b;">New Test Drive Request</h2>
  <table style="width:100%;border-collapse:collapse;">
    ${rows
      .map(
        ([label, value]) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:bold;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(value)}</td>
    </tr>`,
      )
      .join("")}
  </table>
  <h3 style="margin:20px 0 8px;">Comments</h3>
  <p style="white-space:pre-wrap;margin:0;">${escapeHtml(comments)}</p>
</div>`;

  return { text, html };
}

async function sendNotification(request: TestDriveRequest): Promise<void> {
  const { resendApiKey, fromEmail, notifyEmail } = testDriveConfig();
  if (!resendApiKey || !fromEmail) {
    throw new RequestValidationError(
      "Email service is not configured",
      503,
      "SERVICE_NOT_CONFIGURED",
    );
  }
  const { text, html } = notificationEmail(request);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notifyEmail],
      reply_to: request.email,
      subject: `New Test Drive Request - ${request.fullName}`,
      text,
      html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend request failed with status ${response.status}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    enforceClientRateLimit(request, "testDrive");
    const input = await parseStrictJsonBody(request, testDriveRequestSchema, maximumBodyBytes);
    await sendNotification(input);
    logSecurityEvent({
      event: "test_drive.submitted",
      outcome: "success",
      clientHash: clientSecurityHash(request),
    });
    return noStoreJson({ ok: true }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
