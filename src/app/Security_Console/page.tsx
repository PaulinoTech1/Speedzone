import Link from "next/link";

import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Security Console",
  description: "Private SpeedZone security operations console",
};

export default async function SecurityConsolePage() {
  const authenticated = await isAdminAuthenticated();

  return (
    <main className="shell security-console-page">
      <header>
        <p className="eyebrow">SpeedZone security operations</p>
        <h1>Security Console</h1>
        {authenticated ? (
          <>
            <p>Authenticated access is required for security event visibility.</p>
            <p>
              The dedicated security event reader is not mounted in this deployment yet.
            </p>
            <Link className="button button-primary" href="/admin">
              Return to admin inventory
            </Link>
          </>
        ) : (
          <>
            <p>Sign in as an administrator to access this private console.</p>
            <Link className="button button-primary" href="/admin">
              Sign in to admin inventory
            </Link>
          </>
        )}
      </header>
    </main>
  );
}
