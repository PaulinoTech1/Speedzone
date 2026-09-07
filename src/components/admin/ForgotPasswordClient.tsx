"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.requestPasswordReset({
      email: email.trim().toLowerCase(),
      redirectTo: `${window.location.origin}/admin/reset-password`,
    });
    setBusy(false);
    if (result.error) {
      setError("We could not process that request. Please try again later.");
      return;
    }
    setSubmitted(true);
  }

  return (
    <section className="admin-auth-card" aria-labelledby="forgot-password-title">
      <Link className="admin-back-link" href="/admin/login">← Back to sign in</Link>
      <p className="admin-eyebrow">Secure account recovery</p>
      <h1 id="forgot-password-title">Reset your password</h1>
      {submitted ? (
        <p className="admin-alert admin-alert-success" role="status">If that administrator account exists, a reset link has been sent. Check your inbox and spam folder.</p>
      ) : (
        <>
          <p className="admin-lead">Enter your administrator email and we&apos;ll send a one-time reset link.</p>
          <form className="admin-form-stack" onSubmit={submit}>
            <label className="admin-field"><span>Administrator email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <button className="admin-button admin-button-primary admin-button-block" disabled={busy}>{busy ? "Sending link…" : "Send reset link"}</button>
          </form>
          {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}
        </>
      )}
    </section>
  );
}
