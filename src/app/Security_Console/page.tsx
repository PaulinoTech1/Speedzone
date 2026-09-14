import SecurityLoginForm from "./SecurityLoginForm";
import SecuritySessionPanel from "./SecuritySessionPanel";
import { isSecurityAuthenticated } from "../../../security-console/lib/security-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Security Console",
  description: "Private SpeedZone security operations console",
};

export default async function SecurityConsolePage() {
  const authenticated = await isSecurityAuthenticated();

  return (
    <main className="shell security-console-page">
      <header>
        <p className="eyebrow">SpeedZone security operations</p>
        <h1>Security Console</h1>
        <p>Use the dedicated security-console password or passkey. Inventory-admin credentials are not accepted here.</p>
      </header>
      {authenticated ? <SecuritySessionPanel /> : <SecurityLoginForm />}
    </main>
  );
}
