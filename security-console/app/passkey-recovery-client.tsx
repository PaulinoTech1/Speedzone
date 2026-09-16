"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { consolePath } from "../lib/paths";
import { PasskeyLogin } from "./auth-client";

export function PasskeyRecovery() {
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [message, setMessage] = useState("");
  if (registered) return <section className="panel">
    <h2>Passkey registered</h2>
    <p>Use your new passkey to finish signing in.</p>
    <PasskeyLogin />
  </section>;
  return <details className="panel">
    <summary>Can’t use your passkey? Register a recovery passkey</summary>
    <p>Enter your one-time recovery code to add a passkey. Your existing passkeys will be kept.</p>
    <form className="form" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const form = event.currentTarget;
      const code = String(new FormData(form).get("code") || "").trim();
      setBusy(true); setMessage("");
      try {
        const optionsResponse = await fetch(consolePath("/api/auth/passkeys"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recovery-options", code }) });
        const optionsResult = await optionsResponse.json();
        if (!optionsResponse.ok || optionsResult.error) throw new Error(optionsResult.error || "Recovery is unavailable.");
        form.reset();
        const response = await startRegistration({ optionsJSON: optionsResult.options });
        const verified = await fetch(consolePath("/api/auth/passkeys"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recover", response }) });
        const result = await verified.json();
        if (!verified.ok || !result.verified) throw new Error(result.error || "Passkey could not be registered.");
        setRegistered(true);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery failed."); }
      finally { setBusy(false); }
    }}>
      <label>One-time recovery code<input name="code" type="password" autoComplete="off" required minLength={43} maxLength={43} disabled={busy}/></label>
      <button disabled={busy}>{busy ? "Registering…" : "Register recovery passkey"}</button>
      {message && <p className="danger" role="alert">{message}</p>}
    </form>
  </details>;
}
