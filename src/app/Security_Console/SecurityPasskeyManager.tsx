"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

type Passkey = { id: string; name: string; deviceType: string; backedUp: boolean };

function deviceTypeLabel(deviceType: string) {
  return deviceType === "multiDevice" ? "Multi-device passkey" : "Single-device passkey";
}

export default function SecurityPasskeyManager() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadPasskeys() {
    const response = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "passkeys" }) });
    const result = await response.json();
    if (response.ok) setPasskeys(result.passkeys || []);
  }

  useEffect(() => { void loadPasskeys(); }, []);

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
      await loadPasskeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePasskey(id: string) {
    if (!window.confirm("Delete this security-console passkey?")) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/security-console-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete-passkey", id }) });
    const result = await response.json();
    if (response.ok) {
      setMessage("Passkey deleted. Add a new passkey before the next sign-in.");
      await loadPasskeys();
    } else setMessage(result.error || "Passkey could not be deleted.");
    setBusy(false);
  }

  return (
    <form className="panel" onSubmit={addPasskey}>
      <h2>Add a security-console passkey</h2>
      <label htmlFor="security-passkey-name">Passkey name</label>
      <input id="security-passkey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Security key or device" required />
      <button className="button button-primary" disabled={busy} type="submit">Add passkey</button>
      {message && <p className="muted">{message}</p>}
      {passkeys.length > 0 && <div><h3>Registered passkeys</h3>{passkeys.map((passkey) => <div key={passkey.id}><p><strong>{passkey.name}</strong></p><p className="muted">{deviceTypeLabel(passkey.deviceType)}{passkey.backedUp ? " · Backed up" : ""}</p><button className="button button-ghost" disabled={busy} onClick={() => void deletePasskey(passkey.id)} type="button">Delete</button></div>)}</div>}
    </form>
  );
}
