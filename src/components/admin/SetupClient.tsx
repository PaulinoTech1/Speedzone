"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { RecoveryCodes } from "@/components/admin/RecoveryCodes";
import type { RegistrationOptionsResponse } from "@/components/admin/types";
import {
  adminFetch,
  clearClientSecurityState,
  getCsrfToken,
  rememberCsrfToken,
} from "@/lib/client/admin-api";
import { passwordAuthenticationBodySchema } from "@/lib/domain/auth";

type SetupPhase = "credentials" | "enrollment" | "codes";

type BootstrapPreAuthenticationResponse = {
  ok: true;
  bootstrapAuthorized: true;
  csrfToken: string;
};

type BootstrapActivationResponse = {
  ok: true;
  authenticated: false;
  setupComplete: true;
  next: "login";
  recoveryCodes: string[];
};

const genericSetupFailure =
  "Setup could not be completed. Check the setup materials and try again.";

function isPasskeyCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

function validRecoveryCodes(codes: unknown): codes is string[] {
  return (
    Array.isArray(codes) &&
    codes.length === 10 &&
    new Set(codes).size === 10 &&
    codes.every((code) => typeof code === "string" && code.length >= 8 && code.length <= 128)
  );
}

export function SetupClient() {
  const [phase, setPhase] = useState<SetupPhase>("credentials");
  const [administratorId, setAdministratorId] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [passkeyLabel, setPasskeyLabel] = useState("Primary administrator passkey");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    clearClientSecurityState();
    getCsrfToken(true)
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) {
          setError("Setup is unavailable. Refresh this page and try again.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function clearSubmittedSecrets(): void {
    setAdministratorId("");
    setPassword("");
    setBootstrapToken("");
  }

  async function registerInitialPasskey(): Promise<void> {
    const optionResult = await adminFetch<RegistrationOptionsResponse>(
      "/api/admin/auth/bootstrap/options",
      { method: "POST", json: { label: passkeyLabel } },
    );
    const response = await startRegistration({ optionsJSON: optionResult.options });
    const result = await adminFetch<BootstrapActivationResponse>(
      "/api/admin/auth/bootstrap/verify",
      { method: "POST", json: { response } },
    );
    if (
      result.ok !== true ||
      result.authenticated !== false ||
      result.setupComplete !== true ||
      result.next !== "login" ||
      !validRecoveryCodes(result.recoveryCodes)
    ) {
      throw new Error("Invalid setup response");
    }

    clearClientSecurityState();
    setRecoveryCodes(result.recoveryCodes);
    setPhase("codes");
  }

  async function submitSetupCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (!browserSupportsWebAuthn()) {
        setError(
          "This browser does not support passkeys. Use a current browser or a FIDO2 security key on another device.",
        );
        return;
      }

      const credentials = passwordAuthenticationBodySchema.safeParse({
        adminId: administratorId,
        password,
      });
      if (!credentials.success || !/^[A-Za-z0-9_-]{43}$/.test(bootstrapToken)) {
        setError(genericSetupFailure);
        return;
      }

      const authorization = await adminFetch<BootstrapPreAuthenticationResponse>(
        "/api/admin/auth/bootstrap/preauth",
        {
          method: "POST",
          json: { adminId: administratorId, password, bootstrapToken },
        },
      );
      clearSubmittedSecrets();
      if (authorization.ok !== true || authorization.bootstrapAuthorized !== true) {
        throw new Error("Invalid setup authorization response");
      }

      rememberCsrfToken(authorization.csrfToken);
      setPhase("enrollment");
      await registerInitialPasskey();
    } catch (cause) {
      setError(
        isPasskeyCancellation(cause)
          ? "The passkey prompt was canceled or timed out. Your setup authorization expires within five minutes; try again when ready."
          : genericSetupFailure,
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryPasskeyEnrollment() {
    setBusy(true);
    setError("");
    try {
      if (!browserSupportsWebAuthn()) {
        setError("This browser does not support passkeys.");
        return;
      }
      await registerInitialPasskey();
    } catch (cause) {
      setError(
        isPasskeyCancellation(cause)
          ? "The passkey prompt was canceled or timed out. Try again before the five-minute authorization expires."
          : genericSetupFailure,
      );
    } finally {
      setBusy(false);
    }
  }

  async function restartSetup(): Promise<void> {
    setBusy(true);
    clearSubmittedSecrets();
    setRecoveryCodes([]);
    setError("");
    setReady(false);
    clearClientSecurityState();
    try {
      await getCsrfToken(true);
      setReady(true);
      setPhase("credentials");
    } catch {
      setError("Setup is unavailable. Refresh this page and try again.");
    } finally {
      setBusy(false);
    }
  }

  function continueToFreshLogin(): void {
    setRecoveryCodes([]);
    clearSubmittedSecrets();
    clearClientSecurityState();
    window.location.replace("/admin/login");
  }

  if (phase === "codes") {
    return (
      <div className="admin-setup-codes">
        <p className="admin-setup-recommendation">
          Activation is complete. Remove <code>ADMIN_BOOTSTRAP_TOKEN_HASH</code> from Vercel now.
          After the fresh sign in, register a second passkey or hardware security key and keep it
          in a separate, secure location.
        </p>
        <RecoveryCodes
          codes={recoveryCodes}
          continueLabel="Continue to fresh sign in"
          onContinue={continueToFreshLogin}
        />
      </div>
    );
  }

  return (
    <section className="admin-auth-card" aria-labelledby="admin-setup-title">
      <Link className="admin-back-link" href="/">&larr; Return to website</Link>
      <p className="admin-eyebrow">One-time administrator enrollment</p>
      <h1 id="admin-setup-title">Set up secure access</h1>

      {phase === "credentials" ? (
        <>
          <p className="admin-lead">
            Continue only on the final production HTTPS domain. You will verify the offline setup
            materials, then register the first passkey.
          </p>
          <form className="admin-form-stack" onSubmit={submitSetupCredentials}>
            <label className="admin-field">
              <span>Administrator ID</span>
              <input
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                value={administratorId}
                onChange={(event) => setAdministratorId(event.target.value)}
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
              <span>One-time bootstrap token</span>
              <input
                type="password"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
                required
                maxLength={512}
              />
            </label>
            <label className="admin-field">
              <span>Passkey label</span>
              <input
                autoComplete="off"
                value={passkeyLabel}
                onChange={(event) => setPasskeyLabel(event.target.value)}
                required
                maxLength={80}
              />
              <small>Use a name that helps you recognize this device or security key.</small>
            </label>
            <button
              className="admin-button admin-button-primary admin-button-block"
              disabled={!ready || busy}
            >
              {busy ? "Verifying and opening passkey prompt…" : "Verify and register passkey"}
            </button>
          </form>
        </>
      ) : (
        <div className="admin-setup-enrollment">
          <p className="admin-lead">
            Follow the browser prompt to register a passkey. Setup does not create an inventory
            session; a fresh password-and-passkey sign in is required afterward.
          </p>
          {busy ? (
            <div className="admin-auth-wait" role="status">
              <span className="admin-spinner" aria-hidden="true" />
              <p>Waiting for the passkey ceremony…</p>
            </div>
          ) : (
            <div className="admin-setup-actions">
              <button
                className="admin-button admin-button-primary admin-button-block"
                type="button"
                onClick={retryPasskeyEnrollment}
              >
                Try passkey again
              </button>
              <button
                className="admin-text-button"
                type="button"
                onClick={() => void restartSetup()}
              >
                Restart credential verification
              </button>
              <Link className="admin-text-button admin-setup-login-link" href="/admin/login">
                Fresh sign in if registration already completed
              </Link>
            </div>
          )}
        </div>
      )}

      {error ? (
        <p className="admin-alert admin-alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="admin-auth-note">
        The password and bootstrap token are never placed in a URL or saved by this application.
      </p>
    </section>
  );
}
