"use client";

import { useEffect, useState } from "react";

import SecurityPasskeyManager from "./SecurityPasskeyManager";

export default function SecuritySessionPanel() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.search === "?authenticated=1") {
      window.history.replaceState({}, "", "/Security_Console");
      return;
    }
    setBusy(true);
    void fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) }).finally(() => {
      window.location.assign("/Security_Console");
    });
  }, []);

  async function logout() {
    setBusy(true);
    await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    window.location.assign("/Security_Console");
  }

  return (
    <section className="panel">
      <h2>Security console access granted</h2>
      <p>You are signed in with the independent security-console credential. Inventory-admin credentials are not used here.</p>
      <button className="button button-ghost" disabled={busy} onClick={logout} type="button">Sign out</button>
      <SecurityPasskeyManager />
    </section>
  );
}
