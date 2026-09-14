"use client";

import { useState } from "react";

export default function SetupForm() {
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bootstrap", password, bootstrapToken }) });
    const result = await response.json();
    if (response.ok) window.location.assign("/passkeys");
    else setMessage(result.error || "Unable to initialize security authentication.");
    setBusy(false);
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Create the independent security password</h2>
      <label htmlFor="bootstrap-token">Bootstrap token</label>
      <input id="bootstrap-token" type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} required />
      <label htmlFor="new-security-password">New password</label>
      <input id="new-security-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required />
      <p className="muted">Use at least 12 characters. This password is stored in the security Redis and is unrelated to inventory admin credentials.</p>
      <button className="button button-primary" disabled={busy} type="submit">Initialize security access</button>
      {message && <p className="danger">{message}</p>}
    </form>
  );
}
