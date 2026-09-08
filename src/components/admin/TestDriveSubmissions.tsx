"use client";

import { useEffect, useState } from "react";

type Submission = { id: string; pathname: string; name: string; email: string; phone: string; vehicle: string; date: string; time: string; notes: string; createdAt: string };

export default function TestDriveSubmissions() {
  const [items, setItems] = useState<Submission[]>([]);
  const [message, setMessage] = useState("Loading test-drive requests…");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/test-drives", { credentials: "include" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setItems(data);
        setMessage(data.length ? "" : "No test-drive requests yet.");
      })
      .catch((error) => setMessage(error.message));
  }, []);

  async function deleteSubmission(item: Submission) {
    if (!window.confirm(`Delete the test-drive request from ${item.name}? This cannot be undone.`)) return;
    setDeleting(item.pathname);
    try {
      const response = await fetch("/api/admin/test-drives", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: item.pathname }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems((current) => current.filter((submission) => submission.pathname !== item.pathname));
      setMessage("Request deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete request.");
    } finally {
      setDeleting(null);
    }
  }

  return <section className="admin-card admin-submissions"><div className="admin-section-heading"><div><p className="eyebrow">Private submissions</p><h2>Test-drive requests</h2></div><span>Admin only</span></div>{message && <p className="form-message">{message}</p>}<div className="submission-list">{items.map((item) => <article className="submission-item" key={item.id}><div><h3>{item.name}</h3><p>{item.vehicle} · {item.date} at {item.time}</p><p>{item.email} · {item.phone}</p>{item.notes && <p>{item.notes}</p>}</div><div className="submission-actions"><a className="button button-secondary" href={`/api/admin/test-drives?pathname=${encodeURIComponent(item.pathname)}`}>Download</a><button className="button button-danger" type="button" onClick={() => deleteSubmission(item)} disabled={deleting === item.pathname}>{deleting === item.pathname ? "Deleting…" : "Delete"}</button></div></article>)}</div></section>;
}
