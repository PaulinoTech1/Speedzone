"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { consolePath } from "../lib/paths";
import { PasskeyLogin } from "./auth-client";

export function PasskeyBootstrap() {
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [message, setMessage] = useState("");
  if (registered) return <div>
    <p role="status">Passkey saved. Verify it to open the Security Console dashboard.</p>
    <PasskeyLogin />
  </div>;
  return <div>
    <h2>Set up your first passkey</h2>
    <p>Save a passkey on your device or security key, then verify it to open the dashboard.</p>
    <button disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true); setMessage("");
      try {
        const optionsResponse = await fetch(consolePath("/api/auth/passkeys"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bootstrap-options" }) });
        const optionsResult = await optionsResponse.json();
        if (!optionsResponse.ok || optionsResult.error) throw new Error(optionsResult.error || "Passkey setup is unavailable.");
        const response = await startRegistration({ optionsJSON: optionsResult.options });
        const verified = await fetch(consolePath("/api/auth/passkeys"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bootstrap", response }) });
        const result = await verified.json();
        if (!verified.ok || !result.verified) throw new Error(result.error || "Passkey could not be saved.");
        setRegistered(true);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Passkey setup failed."); }
      finally { setBusy(false); }
    }}>{busy ? "Registering passkey..." : "Register first security passkey"}</button>
    {message && <p className="danger" role="alert">{message}</p>}
  </div>;
}
