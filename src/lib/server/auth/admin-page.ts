import "server-only";

import { redirect } from "next/navigation";

/**
 * Server-side gate for the admin CMS pages. Resolves the Better Auth session
 * and confirms it belongs to the configured administrator.
 *
 * The auth/database modules are imported dynamically inside a try/catch so a
 * module-load failure (for example an unreachable database) degrades to
 * "not authenticated" instead of a 500. Combined with the checks below, the
 * gate always fails closed: a missing session, a database problem, or a
 * misconfigured administrator identity all resolve to null.
 */
export async function resolveAdminSession(): Promise<{ administrator: string } | null> {
  try {
    const [{ getAuthSession }, { adminConfig }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/server/env"),
    ]);

    const session = await getAuthSession();
    const email = session?.user?.email;
    if (!email) {
      return null;
    }

    const identifier = adminConfig().identifier.toLowerCase();
    return email.toLowerCase() === identifier ? { administrator: email } : null;
  } catch {
    return null;
  }
}

/**
 * Redirects to the sign-in page unless the caller is the authenticated
 * administrator. `redirect()` is intentionally called outside any try/catch so
 * its control-flow signal is never swallowed.
 */
export async function requireAdminPage(): Promise<{ administrator: string }> {
  const session = await resolveAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  return session;
}
