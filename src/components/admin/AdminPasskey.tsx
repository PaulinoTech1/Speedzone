"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

type PasskeySummary = { id: string; deviceType: string; backedUp: boolean; name?: string };

export default function AdminPasskey({ authenticated, setup = false, onAuthenticated }: { authenticated: boolean; setup?: boolean; onAuthenticated?: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pendingReset, setPendingReset] = useState<string | null>(null);

  async function loadPasskeys() {
    const response = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) });
    if (response.ok) setPasskeys((await response.json()).passkeys || []);
    const status = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "recovery-status" }) });
    if (status.ok) setPendingReset((await status.json()).pendingReset?.executeAt ?? null);
  }
  async function cancelReset() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel-recovery" }) });
      setMessage(response.ok ? "Pending passkey reset cancelled." : "Unable to cancel the pending reset."); await loadPasskeys();
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => { void loadPasskeys(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated]);
  async function authorizeChange(operation: "add" | "delete", id = "") {
    const post = async (body: unknown) => {
      const response = await fetch("/api/admin/passkey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Passkey verification failed");
      return result;
    };
    const { options } = await post({ action: "reauthentication-options", operation, id });
    const response = await startAuthentication({ optionsJSON: options });
    return (await post({ action: "reauthenticate", operation, id, response })).grant as string;
  }
  async function run(action: "register" | "authenticate") {
    const passkeyName = action === "register" ? window.prompt("Name this passkey (for example, Office MacBook):", "")?.trim() : "";
    if (action === "register" && !passkeyName) {
      setMessage("Enter a name for this passkey to continue.");
      return;
    }
    setBusy(true); setMessage(action === "register" ? "Preparing passkey setup…" : "Preparing passkey sign-in…");
    try {
      const grant = action === "register" && !setup ? await authorizeChange("add") : undefined;
      const optionsResponse = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: action === "register" ? "registration-options" : "authentication-options", grant }) });
      const payload = await optionsResponse.json(); if (!optionsResponse.ok) throw new Error(payload.error || "Unable to start passkey flow.");
      const response = action === "register" ? await startRegistration({ optionsJSON: payload.options }) : await startAuthentication({ optionsJSON: payload.options });
      const result = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, response, grant, ...(action === "register" ? { name: passkeyName } : {}) }) });
      const resultPayload = await result.json(); if (!result.ok) throw new Error(resultPayload.error || "Passkey verification failed.");
      if (action === "register" && Array.isArray(resultPayload.recoveryCodes) && resultPayload.recoveryCodes.length) {
        // Shown once. Signing in continues only after the codes are acknowledged.
        setRecoveryCodes(resultPayload.recoveryCodes); setMessage("Passkey added. Save your new recovery codes."); return;
      }
      setMessage(action === "register" ? "Passkey added. You can use it next time." : "Signed in with passkey."); onAuthenticated?.(); if (action === "register") await loadPasskeys();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Passkey flow was cancelled or failed."); } finally { setBusy(false); }
  }
  async function removePasskey(id: string) {
    if (!window.confirm("Delete this passkey? Make sure you can still sign in with the another passkey. Recovery resets access if needed.")) return;
    setBusy(true); setMessage("Deleting passkey…");
    try {
      const grant = await authorizeChange("delete", id);
      const response = await fetch("/api/admin/passkey", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id, grant }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reason || payload.error || "Unable to delete passkey.");
      setMessage("Passkey deleted."); await loadPasskeys();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete passkey."); } finally { setBusy(false); }
  }
  if (recoveryCodes) return <section className="admin-card passkey-card" aria-labelledby="recovery-codes-heading"><h2 id="recovery-codes-heading">Save your recovery codes</h2><p>These single-use codes are shown only once and replace any earlier codes. Store them offline (printed or in a password manager), not in the recovery mailbox. If every passkey is lost, one code plus an emailed recovery link schedules a passkey reset that completes after 48 hours.</p><ul className="recovery-codes">{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul><button className="button button-primary" type="button" onClick={() => { setRecoveryCodes(null); setMessage("Passkey added. You can use it next time."); onAuthenticated?.(); void loadPasskeys(); }}>I saved these codes</button></section>;
  if (!authenticated) return <div className="passkey-login"><button className="button button-secondary" type="button" onClick={() => run("authenticate")} disabled={busy}>{busy ? "Waiting for authenticator…" : "Sign in with passkey"}</button><p className="muted">Accepts Touch ID, Face ID, Windows Hello, Android screen lock, or a FIDO2 USB, NFC, or Bluetooth security key.</p>{message && <p className="form-message" role="status">{message}</p>}</div>;
  return <section className="admin-card passkey-card"><p className="eyebrow">FIDO2 security</p><h2>Passkey sign-in</h2><p>Enroll your first passkey after password setup. Adding or removing a passkey requires fresh verification with an existing passkey. Accepted: platform authenticators (Touch ID, Face ID, Windows Hello, Android screen lock) and roaming FIDO2 security keys (USB, NFC, Bluetooth).</p><p className="muted">Passwords, SMS codes, OTPs, and magic links are not passkeys.</p><button className="button button-secondary" type="button" onClick={() => run("register")} disabled={busy}>{busy ? "Waiting for authenticator…" : "Add passkey"}</button>{pendingReset && <div className="form-message" role="alert"><p><strong>A reset of all passkeys is pending</strong> and can complete after {new Date(pendingReset).toLocaleString()}. If you did not request it, cancel it now.</p><button className="button button-danger" type="button" onClick={cancelReset} disabled={busy}>Cancel passkey reset</button></div>}<div className="passkey-list"><h3>Registered passkeys</h3>{passkeys.length === 0 ? <p className="muted">No passkeys registered yet.</p> : passkeys.map((passkey, index) => <div className="passkey-row" key={passkey.id}><div><strong>{passkey.name || `Passkey ${index + 1}`}</strong><p className="muted">{passkey.deviceType === "singleDevice" ? "Single-device authenticator" : "Multi-device authenticator"}{passkey.backedUp ? " · Backed up" : ""}</p></div><button className="button button-danger" type="button" onClick={() => removePasskey(passkey.id)} disabled={busy}>Delete</button></div>)}</div>{message && <p className="form-message" role="status">{message}</p>}</section>;
}
