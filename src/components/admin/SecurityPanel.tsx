"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { FormEvent, useEffect, useState } from "react";

import { RecoveryCodes } from "@/components/admin/RecoveryCodes";
import type {
  AuthenticationOptionsResponse,
  PasskeySummary,
  PasskeysResponse,
  RegistrationOptionsResponse,
  SessionSummary,
} from "@/components/admin/types";
import { adminFetch, rememberCsrfToken } from "@/lib/client/admin-api";
import { passwordAuthenticationBodySchema } from "@/lib/domain/auth";

type SecurityPanelProps = {
  session: SessionSummary;
  onSessionRefresh: () => Promise<void>;
  onSignedOut: () => void;
};

function readableError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The passkey prompt was canceled or timed out.";
  }
  return error instanceof Error ? error.message : "The security request could not be completed.";
}

export function SecurityPanel({ session, onSessionRefresh, onSignedOut }: SecurityPanelProps) {
  const [stepUpValid, setStepUpValid] = useState(session.stepUpValid);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [managementPassword, setManagementPassword] = useState("");
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[]>([]);

  async function loadPasskeys() {
    const result = await adminFetch<PasskeysResponse>("/api/admin/auth/passkeys");
    setPasskeys(result.passkeys);
  }

  useEffect(() => {
    if (!session.stepUpValid) return;
    let active = true;
    adminFetch<PasskeysResponse>("/api/admin/auth/passkeys")
      .then((result) => {
        if (active) setPasskeys(result.passkeys);
      })
      .catch(() => {
        if (active) setStepUpValid(false);
      });
    return () => {
      active = false;
    };
  }, [session.stepUpValid]);

  async function verifyManagementPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const credentials = passwordAuthenticationBodySchema.safeParse({
        adminId: session.administrator,
        password: managementPassword,
      });
      if (!credentials.success) {
        throw new Error("Password verification could not be completed.");
      }
      const verification = adminFetch<{ ok: true; passwordVerified: true }>(
        "/api/admin/auth/step-up/password",
        {
          method: "POST",
          json: { adminId: session.administrator, password: managementPassword },
        },
      );
      setManagementPassword("");
      const result = await verification;
      if (result.ok !== true || result.passwordVerified !== true) {
        throw new Error("Password verification could not be completed.");
      }
      setPasswordVerified(true);
      setStatus("Password verified. Now verify an existing passkey.");
    } catch {
      setManagementPassword("");
      setPasswordVerified(false);
      setError("Password verification could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyFreshPasskey() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!passwordVerified) {
        throw new Error("Verify the administrator password first.");
      }
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");
      const optionResult = await adminFetch<AuthenticationOptionsResponse>(
        "/api/admin/auth/step-up/options",
        { method: "POST", json: {} },
      );
      const response = await startAuthentication({ optionsJSON: optionResult.options });
      await adminFetch<{ ok: true; stepUp: true }>("/api/admin/auth/step-up/verify", {
        method: "POST",
        json: { response },
      });
      await loadPasskeys();
      await onSessionRefresh();
      setPasswordVerified(false);
      setStepUpValid(true);
      setStatus("Fresh passkey verification complete.");
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "NotAllowedError")) {
        setPasswordVerified(false);
        setStepUpValid(false);
      }
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");
      const optionResult = await adminFetch<RegistrationOptionsResponse>(
        "/api/admin/auth/passkeys/register/options",
        { method: "POST", json: { label } },
      );
      const response = await startRegistration({ optionsJSON: optionResult.options });
      const result = await adminFetch<{
        ok: true;
        passkey: PasskeySummary;
        needsBackupPasskey: boolean;
      }>("/api/admin/auth/passkeys/register/verify", {
          method: "POST",
          json: { response },
        });
      setLabel("");
      setPasskeys((current) => [
        ...current.filter((candidate) => candidate.id !== result.passkey.id),
        result.passkey,
      ]);
      setStepUpValid(false);
      setPasswordVerified(false);
      setManagementPassword("");
      try {
        await onSessionRefresh();
      } catch {
        setError("Passkey added, but session status could not refresh. Reload this page.");
      }
      setStatus(
        "Passkey added. Verify your password and an existing passkey again before another security change.",
      );
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deletePasskey(passkey: PasskeySummary) {
    if (!window.confirm(`Delete “${passkey.label}”? This immediately revokes every existing session.`)) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await adminFetch<{ ok: true; csrfToken: string }>(
        `/api/admin/auth/passkeys/${encodeURIComponent(passkey.id)}`,
        { method: "DELETE", json: {} },
      );
      rememberCsrfToken(result.csrfToken);
      setPasskeys((current) => current.filter((candidate) => candidate.id !== passkey.id));
      setStepUpValid(false);
      setPasswordVerified(false);
      setManagementPassword("");
      await onSessionRefresh();
      setStatus("Passkey deleted and all older sessions revoked. Verify a remaining passkey to continue security changes.");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function rotateRecoveryCodes() {
    if (!window.confirm("Replace every existing recovery code? Old codes will stop working immediately.")) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await adminFetch<{ ok: true; recoveryCodes: string[]; csrfToken?: string }>(
        "/api/admin/auth/recovery/rotate",
        { method: "POST", json: {} },
      );
      if (!Array.isArray(result.recoveryCodes) || result.recoveryCodes.length !== 10) {
        throw new Error("The server did not return a complete recovery-code set.");
      }
      setStepUpValid(false);
      setPasswordVerified(false);
      setManagementPassword("");
      setNewRecoveryCodes(result.recoveryCodes);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revokeAllSessions() {
    if (!window.confirm("Revoke every administrator session, including this one?")) return;
    setBusy(true);
    setError("");
    try {
      await adminFetch<{ ok: true; authenticated: false }>(
        "/api/admin/auth/session/revoke-all",
        { method: "POST", json: {} },
      );
      onSignedOut();
    } catch (cause) {
      setError(readableError(cause));
      setBusy(false);
    }
  }

  if (newRecoveryCodes.length) {
    return (
      <div className="admin-security-page">
        <RecoveryCodes
          codes={newRecoveryCodes}
          continueLabel="Return to security"
          onContinue={() => setNewRecoveryCodes([])}
        />
      </div>
    );
  }

  return (
    <div className="admin-security-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Account protection</p>
        <h1>Security</h1>
        <p>
          Security changes require the administrator password and a fresh assertion from an
          existing passkey.
        </p>
      </header>

      {!stepUpValid ? (
        <section className="admin-panel admin-stepup-panel">
          <div>
            <h2>Verify it’s you</h2>
            <p>
              {passwordVerified
                ? "Password verified. Touch or unlock an existing passkey to continue."
                : "Enter the administrator password, then verify an existing passkey before viewing or changing authenticators."}
            </p>
          </div>
          {passwordVerified ? (
            <button
              className="admin-button admin-button-primary"
              type="button"
              disabled={busy}
              onClick={verifyFreshPasskey}
            >
              {busy ? "Waiting…" : "Verify existing passkey"}
            </button>
          ) : (
            <form className="admin-stepup-password-form" onSubmit={verifyManagementPassword}>
              <label className="admin-field">
                <span>Administrator ID</span>
                <input
                  autoComplete="username"
                  value={session.administrator}
                  readOnly
                  aria-readonly="true"
                />
              </label>
              <label className="admin-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={managementPassword}
                  onChange={(event) => setManagementPassword(event.target.value)}
                  required
                />
              </label>
              <button className="admin-button admin-button-primary" disabled={busy}>
                {busy ? "Checking…" : "Verify password"}
              </button>
            </form>
          )}
        </section>
      ) : (
        <>
          <section className="admin-panel" aria-labelledby="passkeys-title">
            <div className="admin-panel-heading">
              <div><h2 id="passkeys-title">Registered passkeys</h2><p>Private keys stay inside each authenticator.</p></div>
              <span className={`admin-count-badge ${passkeys.length < 2 ? "is-warning" : ""}`}>{passkeys.length} registered</span>
            </div>
            {passkeys.length < 2 ? (
              <p className="admin-alert admin-alert-warning">Register a second passkey and keep it in a different safe location.</p>
            ) : null}
            <ul className="admin-passkey-list">
              {passkeys.map((passkey) => (
                <li key={passkey.id}>
                  <span className="admin-passkey-icon" aria-hidden="true">◆</span>
                  <div>
                    <strong>{passkey.label}</strong>
                    <span>Added {new Date(passkey.createdAt).toLocaleDateString()} · {passkey.transports.join(", ") || "Authenticator-managed"}</span>
                  </div>
                  <button
                    className="admin-button admin-button-danger admin-button-small"
                    type="button"
                    disabled={busy || passkeys.length <= 1}
                    onClick={() => void deletePasskey(passkey)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-panel" aria-labelledby="add-passkey-title">
            <div className="admin-panel-heading">
              <div><h2 id="add-passkey-title">Add a passkey</h2><p>Use this device, a phone, or an external FIDO2 security key.</p></div>
            </div>
            <form className="admin-inline-form" onSubmit={addPasskey}>
              <label className="admin-field">
                <span>Recognizable label</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="Office YubiKey" required />
              </label>
              <button className="admin-button admin-button-primary" disabled={busy}>{busy ? "Waiting…" : "Register passkey"}</button>
            </form>
          </section>

          <section className="admin-panel" aria-labelledby="recovery-title">
            <div className="admin-panel-heading">
              <div>
                <h2 id="recovery-title">Recovery codes</h2>
                <p>Codes are stored only as hashes and cannot be displayed again. Rotating creates ten new single-use codes and invalidates every old code.</p>
              </div>
            </div>
            <button className="admin-button admin-button-secondary" type="button" disabled={busy} onClick={rotateRecoveryCodes}>Replace recovery codes</button>
          </section>

          <section className="admin-panel admin-danger-zone" aria-labelledby="sessions-title">
            <div>
              <h2 id="sessions-title">Revoke every session</h2>
              <p>Use this after a lost device or suspected compromise. You will be signed out here too.</p>
            </div>
            <button className="admin-button admin-button-danger" type="button" disabled={busy} onClick={revokeAllSessions}>Revoke all and sign out</button>
          </section>
        </>
      )}

      {status ? <p className="admin-alert admin-alert-info" role="status">{status}</p> : null}
      {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}
    </div>
  );
}
