import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SetupClient } from "@/components/admin/SetupClient";
import { resolveAdministratorAuthState } from "@/lib/server/auth/state-machine";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administrator Setup",
  description: "One-time SpeedZone Motorsports administrator passkey enrollment.",
};

export default async function AdminSetupPage() {
  let lifecycle: Awaited<ReturnType<typeof resolveAdministratorAuthState>>;
  try {
    lifecycle = await resolveAdministratorAuthState();
  } catch {
    notFound();
  }
  if (lifecycle.state !== "BOOTSTRAP_READY") notFound();

  return (
    <main className="admin-auth-shell">
      <div className="admin-auth-brand" aria-label="SpeedZone Motorsports">
        <span className="admin-brand-mark" aria-hidden="true">SZ</span>
        <span><strong>SpeedZone</strong><small>Motorsports</small></span>
      </div>
      <SetupClient />
    </main>
  );
}
