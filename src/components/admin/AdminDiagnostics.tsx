"use client";

import { useEffect, useState } from "react";
import type { DiagnosticRecord } from "@/lib/diagnostics";

type Data = { events: DiagnosticRecord[]; catalog: { code: string; description: string; remediation: string }[] };
export default function AdminDiagnostics() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("Loading diagnostics…");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/diagnostics", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to read diagnostics." : "Diagnostics are temporarily unavailable."); return response.json() as Promise<Data>; })
      .then(result => { if (!controller.signal.aborted) { setData(result); setMessage(""); } })
      .catch(error => { if (!controller.signal.aborted) { setData(null); setMessage(error instanceof Error ? error.message : "Unable to read diagnostics."); } });
    return () => controller.abort();
  }, [revision]);
  return <section className="admin-card"><h2>Diagnostics</h2><p>Private bug and security reports are available only in the independently authenticated Security Console.</p><button type="button" className="button button-secondary" onClick={() => { setData(null); setMessage("Loading diagnostics…"); setRevision(value => value + 1); }}>Refresh diagnostics</button>{message && <p role="status">{message}</p>}
    {data && <><h3>Recent errors</h3><p>Latest 100 retained samples. Repeated codes are sampled once per minute; records expire after 7 days. Codes describe the operation and failure class, not a proven root cause.</p>{data.events.length === 0 && <p>No retained diagnostics.</p>}{data.events.map(event => <details key={event.reference}><summary>{event.occurredAt} — {event.code}</summary><p>{event.description}</p><p>{event.remediation}</p><p>HTTP {event.status} · Reference: {event.reference}</p></details>)}
    <details><summary>Error-code catalog and troubleshooting</summary>{data.catalog.map(entry => <div key={entry.code}><h4>{entry.code}</h4><p>{entry.description}</p><p>{entry.remediation}</p></div>)}</details></>}
  </section>;
}
