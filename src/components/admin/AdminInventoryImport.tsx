"use client";
import { useState } from "react";
import type { ImportDiff } from "@/lib/integrations/dealercenter/import";

const maxBytes = 1024 * 1024;

/** DealerCenter CSV import: preview a diff, then confirm the exact previewed file. */
export default function AdminInventoryImport({ onApplied }: { onApplied: () => void }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [fullImport, setFullImport] = useState(false);
  const [preview, setPreview] = useState<{ diff: ImportDiff; revision: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function chooseFile(file: File | undefined) {
    setPreview(null); setMessage(""); setCsv(""); setFileName("");
    if (!file) return;
    if (file.size > maxBytes) { setMessage("This file is larger than 1 MB."); return; }
    setCsv(await file.text()); setFileName(file.name);
  }

  async function send(mode: "preview" | "apply") {
    if (!csv || busy) return;
    setBusy(true); setMessage(mode === "preview" ? "Checking file…" : "Applying import…");
    try {
      const response = await fetch("/api/admin/inventory-import", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", ...(mode === "apply" && preview ? { "if-match": preview.revision } : {}) },
        body: JSON.stringify({ csv, mode, fullImport, ...(mode === "apply" ? { digest: preview?.diff.digest } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || "Unable to import inventory."); if (response.status === 409) setPreview(null); return; }
      if (mode === "preview") { setPreview(result); setMessage(""); return; }
      setPreview(null); setCsv(""); setFileName("");
      setMessage(result.applied ? "Import applied." : "Nothing to change.");
      onApplied();
    } catch { setMessage("The connection was interrupted. Preview again before applying."); }
    finally { setBusy(false); }
  }

  const diff = preview?.diff;
  const changes = diff ? diff.added.length + diff.updated.length + diff.removed.length : 0;
  return (
    <section className="admin-card admin-import" aria-labelledby="inventory-import-heading">
      <h2 id="inventory-import-heading">Import from DealerCenter</h2>
      <p className="field-help">Upload a DealerCenter inventory CSV export. You will see every change before anything is saved. Customer and cost columns are discarded unread. Photos are not imported yet.</p>
      <label>Inventory CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { void chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>
      {fileName ? <p>Selected: {fileName}</p> : null}
      <label className="checkbox-label"><input type="checkbox" checked={fullImport} disabled={busy} onChange={e => { setFullImport(e.target.checked); setPreview(null); }} /> This file is my complete inventory (mark vehicles missing from it as sold)</label>
      <div className="admin-listing-actions">
        <button type="button" className="button button-secondary" disabled={!csv || busy} onClick={() => void send("preview")}>Preview import</button>
        {diff ? <button type="button" className="button button-primary" disabled={busy || diff.errors.length > 0 || changes === 0} onClick={() => void send("apply")}>Apply {changes} change{changes === 1 ? "" : "s"}</button> : null}
      </div>
      {diff ? (
        <div className="import-preview" data-testid="import-preview">
          <p><strong>{diff.added.length}</strong> new · <strong>{diff.updated.length}</strong> updated · <strong>{diff.removed.length}</strong> marked sold · {diff.unchanged} unchanged{diff.untouchedManual ? ` · ${diff.untouchedManual} manual listing(s) without VIN/stock left as is` : ""}</p>
          {diff.errors.length ? <><h3>Rows with errors (fix before applying)</h3><ul>{diff.errors.map(error => <li key={error.row}>Row {error.row}{error.key ? ` (${error.key})` : ""}: {error.message}</li>)}</ul></> : null}
          {diff.added.length ? <><h3>New</h3><ul>{diff.added.map(item => <li key={item.key}>{item.title} · {item.key}</li>)}</ul></> : null}
          {diff.updated.length ? <><h3>Updated</h3><ul>{diff.updated.map(item => <li key={item.key}>{item.title} · {item.key}: {item.fields.join(", ")}</li>)}</ul></> : null}
          {diff.removed.length ? <><h3>Marked sold</h3><ul>{diff.removed.map(item => <li key={item.key}>{item.title} · {item.key}</li>)}</ul></> : null}
          {diff.columns.blocked.length ? <p>Discarded columns: {diff.columns.blocked.join(", ")}</p> : null}
          {diff.warnings.length ? <details><summary>{diff.warnings.length} warning(s)</summary><ul>{diff.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
          <details><summary>Column mapping used</summary><ul>{Object.entries(diff.columns.mapped).map(([field, header]) => <li key={field}>{field} ← {header}</li>)}</ul>{diff.columns.ignored.length ? <p>Unused columns: {diff.columns.ignored.join(", ")}</p> : null}</details>
        </div>
      ) : null}
      <p role="status" className="form-message">{message}</p>
    </section>
  );
}
