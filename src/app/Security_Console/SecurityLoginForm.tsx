"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

export default function SecurityLoginForm() {
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [passkeyName, setPasskeyName] = useState("");
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

  async function bootstrap(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const bootstrapResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bootstrap", password, bootstrapToken }) });
      const bootstrapResult = await bootstrapResponse.json();
      if (!bootstrapResponse.ok) throw new Error(bootstrapResult.error || "Unable to initialize security access.");
      const optionsResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "registration-options" }) });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok || optionsResult.error) throw new Error(optionsResult.error || "Unable to start passkey registration.");
      const response = await startRegistration({ optionsJSON: optionsResult.options });
      const registrationResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "registration-verify", response, name: passkeyName }) });
      const registrationResult = await registrationResponse.json();
      if (!registrationResponse.ok || registrationResult.error) throw new Error(registrationResult.error || "Passkey registration failed.");
      setMessage("Security password and passkey initialized. You can now sign in normally.");
      setPassword("");
      setBootstrapToken("");
      setPasskeyName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Security bootstrap failed.");
    } finally {
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
      <form className="panel" onSubmit={bootstrap}>
        <h2>First-time bootstrap</h2>
        <label htmlFor="security-bootstrap-token">Bootstrap token</label>
        <input id="security-bootstrap-token" type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} required />
        <label htmlFor="security-passkey-name">Passkey name</label>
        <input id="security-passkey-name" value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} placeholder="Security key or device" required />
        <p className="muted">Enter the deployment bootstrap token and a password of at least 12 characters. This creates the security-console password and registers its first passkey.</p>
        <button className="button button-primary" disabled={busy} type="submit">Initialize password and passkey</button>
      </form>
      {message && <p className="danger">{message}</p>}
    </>
  );
}
