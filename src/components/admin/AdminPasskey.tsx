"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

type PasskeySummary = { id: string; deviceType: string; backedUp: boolean };

export default function AdminPasskey({ authenticated, onAuthenticated }: { authenticated: boolean; onAuthenticated?: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);

  async function loadPasskeys() {
    const response = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) });
    if (response.ok) setPasskeys((await response.json()).passkeys || []);
  }

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => { void loadPasskeys(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated]);
  async function run(action: "register" | "authenticate") {
    setBusy(true); setMessage(action === "register" ? "Preparing passkey setup…" : "Preparing passkey sign-in…");
    try {
      const optionsResponse = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: action === "register" ? "registration-options" : "authentication-options" }) });
      const payload = await optionsResponse.json(); if (!optionsResponse.ok) throw new Error(payload.error || "Unable to start passkey flow.");
      const response = action === "register" ? await startRegistration({ optionsJSON: payload.options }) : await startAuthentication({ optionsJSON: payload.options });
      const result = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, response }) });
      const resultPayload = await result.json(); if (!result.ok) throw new Error(resultPayload.error || "Passkey verification failed.");
      setMessage(action === "register" ? "Passkey added. You can use it next time." : "Signed in with passkey."); if (action === "authenticate") onAuthenticated?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Passkey flow was cancelled or failed."); } finally { setBusy(false); }
  }
  async function removePasskey(id: string) {
    if (!window.confirm("Delete this passkey? Make sure you can still sign in with the admin password or another passkey.")) return;
    setBusy(true); setMessage("Deleting passkey…");
    try {
      const response = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reason || payload.error || "Unable to delete passkey.");
      setMessage("Passkey deleted."); await loadPasskeys();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete passkey."); } finally { setBusy(false); }
  }
  if (!authenticated) return <div className="passkey-login"><button className="button button-secondary" type="button" onClick={() => run("authenticate")} disabled={busy}>{busy ? "Waiting for authenticator…" : "Sign in with passkey"}</button><p className="muted">Accepts Touch ID, Face ID, Windows Hello, Android screen lock, or a FIDO2 USB, NFC, or Bluetooth security key.</p>{message && <p className="form-message" role="status">{message}</p>}</div>;
  return <section className="admin-card passkey-card"><p className="eyebrow">FIDO2 security</p><h2>Passkey sign-in</h2><p>Add a passkey after signing in with the admin password. Accepted: platform authenticators (Touch ID, Face ID, Windows Hello, Android screen lock) and roaming FIDO2 security keys (USB, NFC, Bluetooth).</p><p className="muted">Passwords, SMS codes, OTPs, and magic links are not passkeys.</p><button className="button button-secondary" type="button" onClick={() => run("register")} disabled={busy}>{busy ? "Waiting for authenticator…" : "Add passkey"}</button><div className="passkey-list"><h3>Registered passkeys</h3>{passkeys.length === 0 ? <p className="muted">No passkeys registered yet.</p> : passkeys.map((passkey, index) => <div className="passkey-row" key={passkey.id}><div><strong>Passkey {index + 1}</strong><p className="muted">{passkey.deviceType === "singleDevice" ? "Single-device authenticator" : "Multi-device authenticator"}{passkey.backedUp ? " · Backed up" : ""}</p></div><button className="button button-danger" type="button" onClick={() => removePasskey(passkey.id)} disabled={busy || passkeys.length === 1}>Delete</button></div>)}</div>{message && <p className="form-message" role="status">{message}</p>}</section>;
}
