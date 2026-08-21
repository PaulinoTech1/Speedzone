"use client";

import { useState } from "react";

type RecoveryCodesProps = {
  codes: string[];
  onContinue: () => void;
  continueLabel?: string;
};

export function RecoveryCodes({ codes, onContinue, continueLabel = "Continue" }: RecoveryCodesProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopyStatus("Copied. Store them somewhere offline now.");
    } catch {
      setCopyStatus("Copy was blocked by the browser. Select and save the codes manually.");
    }
  }

  function downloadCodes() {
    const contents = [
      "SpeedZone Motorsports administrator recovery codes",
      "Each code can be used once. Keep these offline and private.",
      "",
      ...codes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "speedzone-recovery-codes.txt";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className="admin-auth-card admin-recovery-codes" aria-labelledby="recovery-codes-title">
      <p className="admin-eyebrow">One-time display</p>
      <h1 id="recovery-codes-title">Save your recovery codes</h1>
      <p className="admin-lead">
        These ten codes replace a lost passkey only when paired with the administrator password.
        Each works once, and the server cannot show them again.
      </p>

      <ol className="admin-code-grid" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}><code>{code}</code></li>
        ))}
      </ol>

      <div className="admin-action-row">
        <button className="admin-button admin-button-secondary" type="button" onClick={copyCodes}>
          Copy all
        </button>
        <button className="admin-button admin-button-secondary" type="button" onClick={downloadCodes}>
          Download text file
        </button>
      </div>
      {copyStatus ? <p className="admin-inline-status" role="status">{copyStatus}</p> : null}

      <label className="admin-check-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I saved these codes somewhere private and offline.</span>
      </label>
      <button
        className="admin-button admin-button-primary admin-button-block"
        type="button"
        disabled={!confirmed}
        onClick={onContinue}
      >
        {continueLabel}
      </button>
    </section>
  );
}
