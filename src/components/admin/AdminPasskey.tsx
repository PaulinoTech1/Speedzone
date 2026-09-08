"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

export default function AdminPasskey({ authenticated, onAuthenticated }: { authenticated: boolean; onAuthenticated?: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
  if (!authenticated) return <div className="passkey-login"><button className="button button-secondary" type="button" onClick={() => run("authenticate")} disabled={busy}>{busy ? "Waiting for authenticator…" : "Sign in with passkey"}</button><p className="muted">Accepts Touch ID, Face ID, Windows Hello, Android screen lock, or a FIDO2 USB, NFC, or Bluetooth security key.</p>{message && <p className="form-message" role="status">{message}</p>}</div>;
  return <section className="admin-card passkey-card"><p className="eyebrow">FIDO2 security</p><h2>Passkey sign-in</h2><p>Add a passkey after signing in with the admin password. Accepted: platform authenticators (Touch ID, Face ID, Windows Hello, Android screen lock) and roaming FIDO2 security keys (USB, NFC, Bluetooth).</p><p className="muted">Passwords, SMS codes, OTPs, and magic links are not passkeys.</p><button className="button button-secondary" type="button" onClick={() => run("register")} disabled={busy}>{busy ? "Waiting for authenticator…" : "Add passkey"}</button>{message && <p className="form-message" role="status">{message}</p>}</section>;
}
