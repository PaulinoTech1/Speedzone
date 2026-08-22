import "server-only";

import { leadNotificationConfig } from "@/lib/server/env";
import { RequestValidationError } from "@/lib/server/request";

export function escapeHtml(value: string): string {
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

export function renderLeadEmail(
  heading: string,
  rows: [string, string][],
  comments: string,
): { text: string; html: string } {
  const trimmedComments = comments.trim() || "(none)";
  const text = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Comments:",
    trimmedComments,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;">
  <h2 style="margin:0 0 16px;color:#d9001b;">${escapeHtml(heading)}</h2>
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
  <p style="white-space:pre-wrap;margin:0;">${escapeHtml(trimmedComments)}</p>
</div>`;

  return { text, html };
}

export async function sendLeadNotification(options: {
  subject: string;
  replyTo: string;
  text: string;
  html: string;
}): Promise<void> {
  const { resendApiKey, fromEmail, notifyEmail } = leadNotificationConfig();
  if (!resendApiKey || !fromEmail) {
    throw new RequestValidationError(
      "Email service is not configured",
      503,
      "SERVICE_NOT_CONFIGURED",
    );
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notifyEmail],
      reply_to: options.replyTo,
      subject: options.subject,
      text: options.text,
      html: options.html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend request failed with status ${response.status}`);
  }
}
