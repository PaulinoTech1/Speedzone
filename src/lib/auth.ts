import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { headers } from "next/headers";

import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/server/auth-email";
import * as schema from "@/lib/db/schema";

const originCandidates = process.env.NODE_ENV === "development"
  ? ["http://localhost:4173", process.env.V0_RUNTIME_URL, process.env.V0_DEV_APP_URL, process.env.V0_BUILD_URL, process.env.V0_SANDBOX_URL]
  : [process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: 30 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ email: user.email, url });
    },
  },
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEON_AUTH_BASE_URL ??
    (process.env.NODE_ENV === "development" ? process.env.V0_RUNTIME_URL : undefined) ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
  trustedOrigins: originCandidates.filter((value): value is string => Boolean(value)),
  ...(process.env.NODE_ENV === "development" ? { advanced: { defaultCookieAttributes: { sameSite: "none", secure: true } } } : {}),
});

export async function getAuthSession() {
  return auth.api.getSession({ headers: await headers() });
}
