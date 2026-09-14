"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

export default function SecurityPasskeyManager() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function addPasskey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const optionsResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "registration-options" }) });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok || optionsResult.error) throw new Error(optionsResult.error || "Passkey registration is unavailable.");
      const response = await startRegistration({ optionsJSON: optionsResult.options });
      const verifyResponse = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "registration-verify", response, name }) });
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok || verifyResult.error) throw new Error(verifyResult.error || "Passkey registration failed.");
      setName("");
      setMessage("Passkey added to the security console.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={addPasskey}>
      <h2>Add a security-console passkey</h2>
      <label htmlFor="security-passkey-name">Passkey name</label>
      <input id="security-passkey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Security key or device" required />
      <button className="button button-primary" disabled={busy} type="submit">Add passkey</button>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}
