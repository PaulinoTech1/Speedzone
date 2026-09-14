"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

export default function PasskeyManager() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const optionsResponse = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "registration-options" }) });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok || optionsResult.error) throw new Error(optionsResult.error || "Passkey registration is unavailable.");
      const response = await startRegistration({ optionsJSON: optionsResult.options });
      const verifyResponse = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "registration-verify", response, name }) });
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok || verifyResult.error) throw new Error(verifyResult.error || "Passkey could not be registered.");
      setMessage("Passkey registered. You can now use it for independent security-console login.");
      setName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={register}>
      <h2>Register an independent passkey</h2>
      <label htmlFor="passkey-name">Passkey name</label>
      <input id="passkey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Security key or device" />
      <button className="button button-primary" disabled={busy} type="submit">Register passkey</button>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}
