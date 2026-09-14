"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";

export default function SecurityLoginForm() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loginWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "password-login", password }) });
    const result = await response.json();
    if (response.ok) window.location.assign("/Security_Console");
    else { setMessage(result.error || "Unable to sign in."); setBusy(false); }
  }

  async function loginWithPasskey() {
    setBusy(true);
    setMessage("");
    try {
      const optionsResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authentication-options" }) });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(optionsResult.error || "Passkey login is unavailable.");
      const response = await startAuthentication({ optionsJSON: optionsResult.options });
      const verifyResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authentication-verify", response }) });
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verifyResult.error || "Passkey could not be verified.");
      window.location.assign("/Security_Console");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey login failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <form className="panel" onSubmit={loginWithPassword}>
        <h2>Security-console password</h2>
        <label htmlFor="security-console-password">Password</label>
        <input id="security-console-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <button className="button button-primary" disabled={busy} type="submit">Sign in with password</button>
      </form>
      <button className="button button-ghost" disabled={busy} onClick={loginWithPasskey} type="button">Sign in with passkey</button>
      {message && <p className="danger">{message}</p>}
    </>
  );
}
