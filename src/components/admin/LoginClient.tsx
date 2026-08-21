"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { RecoveryCodes } from "@/components/admin/RecoveryCodes";
import type {
  AuthenticationOptionsResponse,
  RegistrationOptionsResponse,
} from "@/components/admin/types";
import {
  adminFetch,
  clearClientSecurityState,
  getCsrfToken,
  rememberCsrfToken,
} from "@/lib/client/admin-api";
import { passwordAuthenticationBodySchema } from "@/lib/domain/auth";

type LoginMode =
  | "password"
  | "passkey"
  | "recovery"
  | "recovery-passkey"
  | "codes";

type PasswordResponse = {
  ok: true;
  authenticationStep: "passkey";
  csrfToken: string;
};

type SessionResponse = { ok: true; authenticated: true; csrfToken: string };
type CodesResponse = {
  ok: true;
  authenticated: false;
  next: "login";
  recoveryCodes: string[];
};

function readableError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The passkey prompt was canceled or timed out. Try again when you are ready.";
  }
  if (error instanceof Error) return error.message;
  return "Authentication could not be completed.";
}

export function LoginClient() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCsrfToken()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((cause: unknown) => {
        if (active) setError(readableError(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  function finishAuthentication() {
    router.replace("/admin");
    router.refresh();
  }

  function returnToFreshLogin() {
    setRecoveryCodes([]);
    setIdentifier("");
    setPassword("");
    setRecoveryCode("");
    setMode("password");
    setReady(false);
    setError("Recovery is complete. Sign in normally with your password and newly registered passkey.");
    clearClientSecurityState();
    getCsrfToken(true)
      .then(() => setReady(true))
      .catch((cause: unknown) => setError(readableError(cause)));
  }

  async function authenticateWithPasskey() {
    if (!browserSupportsWebAuthn()) {
      throw new Error("This browser does not support passkeys. Use a current browser or a FIDO2 security key on another device.");
    }
    setMode("passkey");
    const optionResult = await adminFetch<AuthenticationOptionsResponse>(
      "/api/admin/auth/webauthn/options",
      { method: "POST", json: {} },
    );
    const response = await startAuthentication({ optionsJSON: optionResult.options });
    const result = await adminFetch<SessionResponse>("/api/admin/auth/webauthn/verify", {
      method: "POST",
      json: { response },
    });
    rememberCsrfToken(result.csrfToken);
    finishAuthentication();
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const validation = passwordAuthenticationBodySchema.safeParse({
        adminId: identifier,
        password,
      });
      if (!validation.success) {
        throw new Error(
          "Enter a valid administrator ID and a password no longer than 128 characters or 512 UTF-8 bytes.",
        );
      }
      const result = await adminFetch<PasswordResponse>("/api/admin/auth/password", {
        method: "POST",
        json: { adminId: identifier, password },
      });
      // The server rotates the pre-authentication binding after the password step.
      rememberCsrfToken(result.csrfToken);
      if (result.authenticationStep !== "passkey") throw new Error("Invalid authentication response");
      await authenticateWithPasskey();
    } catch (cause) {
      setMode("password");
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await adminFetch<{ ok: true; csrfToken: string }>("/api/admin/auth/recovery/start", {
        method: "POST",
        json: { identifier, password, recoveryCode },
      });
      // A recovery proof is intentionally separate from sessions and pre-auth.
      // Keep the proof-bound CSRF token returned by the server in memory.
      rememberCsrfToken(result.csrfToken);
      setPasskeyLabel("Replacement administrator passkey");
      setMode("recovery-passkey");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function registerRecoveryPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");
      const optionResult = await adminFetch<RegistrationOptionsResponse>(
        "/api/admin/auth/recovery/options",
        { method: "POST", json: { label: passkeyLabel } },
      );
      const response = await startRegistration({ optionsJSON: optionResult.options });
      await adminFetch<{ ok: true; finalizeRequired: true }>("/api/admin/auth/recovery/verify", {
        method: "POST",
        json: { response },
      });
      const result = await adminFetch<CodesResponse>("/api/admin/auth/recovery/finalize", {
        method: "POST",
        json: {},
      });
      clearClientSecurityState();
      setPassword("");
      setRecoveryCode("");
      setRecoveryCodes(result.recoveryCodes);
      setMode("codes");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "codes") {
    return (
      <RecoveryCodes
        codes={recoveryCodes}
        continueLabel="Return to sign in"
        onContinue={returnToFreshLogin}
      />
    );
  }

  return (
    <section className="admin-auth-card" aria-labelledby="admin-login-title">
      <Link className="admin-back-link" href="/">← Return to website</Link>
      <p className="admin-eyebrow">Protected inventory</p>
      <h1 id="admin-login-title">
        {mode === "recovery" || mode === "recovery-passkey"
          ? "Recover administrator access"
          : "Administrator sign in"}
      </h1>

      {mode === "password" ? (
        <>
          <p className="admin-lead">Sign in requires your password and a registered passkey.</p>
          <form className="admin-form-stack" onSubmit={submitPassword}>
            <label className="admin-field">
              <span>Administrator ID</span>
              <input
                autoCapitalize="none"
                autoComplete="username webauthn"
                spellCheck={false}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
                maxLength={254}
              />
            </label>
            <label className="admin-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="admin-button admin-button-primary admin-button-block" disabled={!ready || busy}>
              {busy ? "Checking…" : "Continue with passkey"}
            </button>
          </form>
          <button
            className="admin-text-button"
            type="button"
            onClick={() => {
              setError("");
              setMode("recovery");
            }}
          >
            Lost every passkey? Use a recovery code
          </button>
          <Link className="admin-text-button admin-setup-login-link" href="/admin/setup">
            First-time administrator setup
          </Link>
        </>
      ) : null}

      {mode === "passkey" ? (
        <div className="admin-auth-wait" role="status">
          <span className="admin-spinner" aria-hidden="true" />
          <p>Follow your browser’s passkey prompt to finish signing in.</p>
        </div>
      ) : null}

      {mode === "recovery" ? (
        <>
          <p className="admin-lead">
            Recovery requires the administrator password and one unused recovery code. It will
            replace the lost passkey and rotate all recovery codes.
          </p>
          <form className="admin-form-stack" onSubmit={startRecovery}>
            <label className="admin-field">
              <span>Administrator ID</span>
              <input
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
                maxLength={254}
              />
            </label>
            <label className="admin-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label className="admin-field">
              <span>Unused recovery code</span>
              <input
                autoCapitalize="characters"
                autoComplete="one-time-code"
                spellCheck={false}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                required
                maxLength={128}
              />
            </label>
            <button className="admin-button admin-button-danger admin-button-block" disabled={!ready || busy}>
              {busy ? "Checking…" : "Start secure recovery"}
            </button>
          </form>
          <button className="admin-text-button" type="button" onClick={() => setMode("password")}>
            Back to regular sign in
          </button>
        </>
      ) : null}

      {mode === "recovery-passkey" ? (
        <>
          <p className="admin-lead">
            Register the replacement passkey. Access is not restored until registration is
            verified and finalized.
          </p>
          <form className="admin-form-stack" onSubmit={registerRecoveryPasskey}>
            <label className="admin-field">
              <span>Replacement passkey label</span>
              <input
                value={passkeyLabel}
                onChange={(event) => setPasskeyLabel(event.target.value)}
                required
                maxLength={80}
              />
            </label>
            <button className="admin-button admin-button-primary admin-button-block" disabled={busy}>
              {busy ? "Waiting for passkey…" : "Register replacement passkey"}
            </button>
          </form>
        </>
      ) : null}

      {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}
      <p className="admin-auth-note">Credentials and recovery codes are never stored in this browser.</p>
    </section>
  );
}
