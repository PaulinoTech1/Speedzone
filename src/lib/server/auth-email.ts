import "server-only";

import { Resend } from "resend";

import { requiredEnv } from "@/lib/server/env";

function resetEmailConfig() {
  const configuredSender = requiredEnv("RESEND_EMAIL_DOMAIN");
  const apiKey = requiredEnv("RESEND_API_KEY");
  const sender = configuredSender.includes("@")
    ? configuredSender
    : `no-reply@${configuredSender}`;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender)) {
    throw new Error("RESEND_EMAIL_DOMAIN must be a verified domain or sender email");
  }

  return {
    resend: new Resend(apiKey),
    from: `SpeedZone Motorsports <${sender}>`,
  };
}

/**
 * Better Auth encodes the reset token as a path segment
 * (`/reset-password/<token>`), not a query parameter, so it must be read from
 * the pathname. This keeps the Resend idempotency key unique per reset request;
 * a constant key makes Resend suppress every reset email after the first within
 * its retention window, which silently breaks repeat recovery attempts.
 */
function resetTokenFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const marker = segments.lastIndexOf("reset-password");
    const token = marker >= 0 ? segments[marker + 1] : segments.at(-1);
    return token ? decodeURIComponent(token) : "request";
  } catch {
    return "request";
  }
}

export async function sendPasswordResetEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  const { resend, from } = resetEmailConfig();
  const { error } = await resend.emails.send(
    {
      from,
      to: [email],
      subject: "Reset your SpeedZone administrator password",
      text: `Use this secure link to reset your SpeedZone administrator password:\n\n${url}\n\nThis link expires soon. If you did not request it, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111"><h2>Reset your SpeedZone administrator password</h2><p>Use the button below to choose a new password.</p><p><a href="${url}" style="display:inline-block;background:#d9001b;color:#fff;padding:12px 18px;text-decoration:none;border-radius:4px">Reset password</a></p><p>This link expires soon. If you did not request it, you can ignore this email.</p></div>`,
    },
    { idempotencyKey: `admin-password-reset/${email}/${resetTokenFromUrl(url)}` },
  );
  if (error) {
    console.error("Password reset email failed", error.message);
    throw new Error("Password reset email could not be sent");
  }
}

export function authBaseUrl(): string {
  return process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined) ??
    process.env.V0_RUNTIME_URL ??
    "http://localhost:4173";
}
