import { redirect } from "next/navigation";

import { LoginClient } from "@/components/admin/LoginClient";
import { resolveAdminSession } from "@/lib/server/auth/admin-page";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  // An already-authenticated administrator skips the sign-in form entirely.
  if (await resolveAdminSession()) {
    redirect("/admin");
  }

  return (
    <main className="admin-auth-shell">
      <div className="admin-auth-brand" aria-label="SpeedZone Motorsports">
        <span className="admin-brand-mark" aria-hidden="true">SZ</span>
        <span><strong>SpeedZone</strong><small>Motorsports</small></span>
      </div>
      <LoginClient />
    </main>
  );
}
