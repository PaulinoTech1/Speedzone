"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!token) {
      setError("This reset link is missing or invalid.");
      return;
    }
    if (password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (result.error) {
      setError("This reset link is invalid or expired. Request a new one.");
      return;
    }
    setMessage("Your password has been changed. You can now sign in.");
    setPassword("");
    setConfirmation("");
  }

  return (
    <section className="admin-auth-card" aria-labelledby="reset-password-title">
      <Link className="admin-back-link" href="/admin/login">← Back to sign in</Link>
      <p className="admin-eyebrow">Secure account recovery</p>
      <h1 id="reset-password-title">Choose a new password</h1>
      <p className="admin-lead">Use at least 12 characters. This link can only be used once.</p>
      <form className="admin-form-stack" onSubmit={submit}>
        <label className="admin-field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></label>
        <label className="admin-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required /></label>
        <button className="admin-button admin-button-primary admin-button-block" disabled={busy}>{busy ? "Updating password…" : "Update password"}</button>
      </form>
      {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}
      {message ? <p className="admin-alert admin-alert-success" role="status">{message}</p> : null}
    </section>
  );
}
