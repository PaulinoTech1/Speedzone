"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStep, setPasswordStep] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loginWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "password-login", password }) });
    const result = await response.json();
    if (response.ok) {
      setPasswordStep(true);
      await loginWithPasskey(true);
    }
    else setMessage(result.error || "Unable to sign in.");
    setBusy(false);
  }

  async function loginWithPasskey(passwordJustVerified = false) {
    setBusy(true);
    setMessage("");
    try {
      if (!passwordStep && !passwordJustVerified) throw new Error("Enter the security-console password first.");
      const optionsResponse = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authentication-options" }) });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok || optionsResult.error || !optionsResult.options) throw new Error(optionsResult.error || "Passkey login is unavailable.");
      const response = await startAuthentication({ optionsJSON: optionsResult.options });
      const verifyResponse = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authentication-verify", response }) });
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok || verifyResult.error || !verifyResult.authenticated) throw new Error(verifyResult.error || "Passkey could not be verified.");
      router.push("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey login failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <form className="panel" onSubmit={loginWithPassword}>
        <h2>Independent security password</h2>
        <label htmlFor="security-password">Password</label>
        <input id="security-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <button className="button button-ghost" type="button" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide password" : "Show password"}</button>
        <button className="button button-primary" disabled={busy} type="submit">Sign in with password</button>
      </form>
      <button className="button button-ghost" disabled={busy || !passwordStep} onClick={() => loginWithPasskey()} type="button">Continue with passkey</button>
      {message && <p className="danger">{message}</p>}
    </>
  );
}
