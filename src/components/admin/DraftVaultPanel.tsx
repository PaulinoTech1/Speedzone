"use client";

import { FormEvent, useEffect, useState } from "react";

import type { VehicleFormValues } from "@/components/admin/types";
import {
  deleteEncryptedDraft,
  isDraftVaultUnlocked,
  loadEncryptedDraft,
  lockDraftVault,
  saveEncryptedDraft,
  unlockDraftVault,
} from "@/lib/client/draft-vault";

type StoredVehicleDraft = {
  schemaVersion: 1;
  baseVersion: number | null;
  form: VehicleFormValues;
};

type DraftVaultPanelProps = {
  recordKey: string;
  baseVersion: number | null;
  form: VehicleFormValues;
  onLoad: (draft: VehicleFormValues, basedOnVersion: number | null) => void;
};

export function DraftVaultPanel({ recordKey, baseVersion, form, onLoad }: DraftVaultPanelProps) {
  const [unlocked, setUnlocked] = useState(() => isDraftVaultUnlocked());
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => {
      saveEncryptedDraft(recordKey, { schemaVersion: 1, baseVersion, form } satisfies StoredVehicleDraft)
        .then(() => setStatus(`Encrypted locally at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`))
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Local autosave failed"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [baseVersion, form, recordKey, unlocked]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Deriving the local key…");
    try {
      await unlockDraftVault(passphrase);
      setPassphrase("");
      setUnlocked(true);
      setStatus("Vault unlocked in memory for this tab.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The local vault could not be unlocked");
    }
  }

  async function loadDraft() {
    setStatus("Opening encrypted draft…");
    try {
      const draft = await loadEncryptedDraft<StoredVehicleDraft>(recordKey);
      if (!draft || draft.schemaVersion !== 1 || !draft.form) {
        setStatus("No encrypted local draft exists for this vehicle.");
        return;
      }
      onLoad(draft.form, draft.baseVersion);
      setStatus("Encrypted local draft loaded. Review it before saving to the server.");
    } catch {
      setStatus("Could not decrypt this draft. Check the local vault passphrase.");
    }
  }

  async function removeDraft() {
    try {
      await deleteEncryptedDraft(recordKey);
      setStatus("Encrypted local draft removed from this browser.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The local draft could not be removed");
    }
  }

  function lock() {
    lockDraftVault();
    setPassphrase("");
    setUnlocked(false);
    setStatus("Vault key reference cleared from application memory.");
  }

  return (
    <aside className="admin-vault" aria-labelledby="draft-vault-title">
      <div>
        <p className="admin-eyebrow">Optional browser-only protection</p>
        <h3 id="draft-vault-title">Encrypted local autosave</h3>
        <p>
          This uses a separate local vault passphrase that is never sent to SpeedZone. Losing it
          makes these browser drafts unrecoverable. JavaScript memory cannot be reliably zeroized;
          locking drops this application’s key reference.
        </p>
      </div>

      {!unlocked ? (
        <form className="admin-vault-unlock" onSubmit={unlock}>
          <label className="admin-field">
            <span>Local vault passphrase</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              required
            />
          </label>
          <button className="admin-button admin-button-secondary">Unlock local vault</button>
        </form>
      ) : (
        <div className="admin-action-row">
          <button className="admin-button admin-button-secondary" type="button" onClick={loadDraft}>Load local draft</button>
          <button className="admin-button admin-button-secondary" type="button" onClick={removeDraft}>Delete local draft</button>
          <button className="admin-button admin-button-quiet" type="button" onClick={lock}>Lock vault</button>
        </div>
      )}
      {status ? <p className="admin-inline-status" role="status">{status}</p> : null}
    </aside>
  );
}

