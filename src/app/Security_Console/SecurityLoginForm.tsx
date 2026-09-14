"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";

export default function SecurityLoginForm() {
  const [password, setPassword] = useState("");
  const [passwordStep, setPasswordStep] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loginWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "password-login", password }) });
    const result = await response.json();
    if (response.ok) {
      setPasswordStep(true);
      await loginWithPasskey(true);
    }
    else { setMessage(result.error || "Unable to sign in."); setBusy(false); }
  }

  async function loginWithPasskey(passwordJustVerified = false) {
    setBusy(true);
    setMessage("");
    try {
      if (!passwordStep && !passwordJustVerified) throw new Error("Enter the security-console password first.");
      const optionsResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authentication-options" }) });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok || optionsResult.error || !optionsResult.options) throw new Error(optionsResult.error || "Passkey login is unavailable.");
      const response = await startAuthentication({ optionsJSON: optionsResult.options });
      const verifyResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authentication-verify", response }) });
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok || verifyResult.error || !verifyResult.authenticated) throw new Error(verifyResult.error || "Passkey could not be verified.");
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
      <button className="button button-ghost" disabled={busy || !passwordStep} onClick={() => loginWithPasskey()} type="button">Continue with passkey</button>
      <p className="muted">Both the security-console password and a registered passkey are required.</p>
      {message && <p className="danger">{message}</p>}
    </>
  );
}
