"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (result.error) {
      setError("Unable to sign in with those credentials.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <section className="admin-auth-card" aria-labelledby="admin-login-title">
      <Link className="admin-back-link" href="/">← Return to website</Link>
      <p className="admin-eyebrow">Protected inventory</p>
      <h1 id="admin-login-title">Administrator sign in</h1>
      <p className="admin-lead">Use your Neon Auth administrator account to manage Sanity inventory.</p>
      <form className="admin-form-stack" onSubmit={submit}>
        <label className="admin-field"><span>Administrator email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="admin-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="admin-button admin-button-primary admin-button-block" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button>
      </form>
      {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}
    </section>
  );
}
