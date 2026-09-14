"use client";

import { useRef, useState, type FormEvent } from "react";

export function BugReportForm() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    active.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bug-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) {
        setMessage(response.status === 429 ? "The reporting limit has been reached. Please wait before trying again." : (result.error || "Unable to send your report.") + (result.reference ? ` Reference: ${result.reference}` : ""));
        return;
      }
      setReceipt(result.reference);
    } catch { setMessage("We could not confirm delivery. Please wait before retrying; your report may already have arrived."); }
    finally { active.current = false; setBusy(false); }
  }
  if (receipt) return <section className="form-success" role="status"><h2>Report received</h2><p>Save this reference: {receipt}</p><p>An administrator will review your report. This is not an emergency support channel.</p></section>;
  return <form className="test-drive-form" onSubmit={submit}>
    <label>Report type<select name="category" defaultValue="functional"><option value="functional">Website problem</option><option value="accessibility">Accessibility problem</option><option value="security">Security concern</option></select></label>
    <label>Short summary<input name="title" required minLength={5} maxLength={120} /></label>
    <label>What happened and how to reproduce it<textarea name="details" required minLength={20} maxLength={4000} rows={8} /></label>
    <label>Page path (optional)<input name="page" maxLength={160} placeholder="/inventory" pattern="/[a-zA-Z0-9/_\-]*" /><span>Only a path, without query parameters or account information.</span></label>
    <label>Support reference (optional)<input name="reference" maxLength={36} placeholder="Reference from an error message" /></label>
    <label>Reply email (optional)<input name="contact" type="email" maxLength={254} autoComplete="email" /></label>
    <p>Reports are private to administrators, encrypted in storage, and expire after 30 days. Do not include passwords, tokens, customer records, or exploit attachments.</p>
    {message && <p role="alert" className="form-error">{message}</p>}
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
  </form>;
}
