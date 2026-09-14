import SecurityLoginForm from "./SecurityLoginForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Security Console",
  description: "Private SpeedZone security operations console",
};

export default async function SecurityConsolePage() {
  return (
    <main className="shell security-console-page">
      <header>
        <p className="eyebrow">SpeedZone security operations</p>
        <h1>Security Console</h1>
        <p>Use the dedicated security-console password or passkey. Inventory-admin credentials are not accepted here.</p>
      </header>
      <SecurityLoginForm />
    </main>
  );
}
