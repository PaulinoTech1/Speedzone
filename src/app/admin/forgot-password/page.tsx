import { ForgotPasswordClient } from "@/components/admin/ForgotPasswordClient";

export const dynamic = "force-dynamic";

export default function AdminForgotPasswordPage() {
  return (
    <main className="admin-auth-shell">
      <div className="admin-auth-brand" aria-label="SpeedZone Motorsports">
        <span className="admin-brand-mark" aria-hidden="true">SZ</span>
        <span><strong>SpeedZone</strong><small>Motorsports</small></span>
      </div>
      <ForgotPasswordClient />
    </main>
  );
}
