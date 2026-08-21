import { LoginClient } from "@/components/admin/LoginClient";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
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

