"use client";

import { useEffect, useRef, useState } from "react";

type Submission = {
  id?: string;
  pathname: string;
  unreadable?: boolean;
  name?: string;
  email?: string;
  phone?: string;
  vehicle?: string;
  date?: string;
  time?: string;
  notes?: string;
  createdAt?: string;
};

export default function TestDriveSubmissions() {
  const [items, setItems] = useState<Submission[]>([]);
  const [message, setMessage] = useState("Loading test-drive requests…");

  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);

  async function loadMore() {
    if (!cursor || pending.current) return;
    pending.current = true; setLoading(true);
    try {
      const response = await fetch(`/api/admin/test-drives?cursor=${encodeURIComponent(cursor)}`, { credentials: "include", cache: "no-store" });
      if (response.status === 401) { setItems([]); setCursor(null); throw new Error("Session expired. Sign in again."); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load requests.");
      setItems(current => [...new Map([...current, ...data].map(item => [item.pathname, item])).values()]);
      setCursor(response.headers.get("x-next-cursor")); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load requests."); }
    finally { pending.current = false; setLoading(false); }
  }

  useEffect(() => {
    fetch("/api/admin/test-drives", { credentials: "include" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setCursor(response.headers.get("x-next-cursor"));
        setItems(data);
        setMessage(data.length ? "" : "No test-drive requests yet.");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load requests."));
  }, []);

  return (
    <section className="admin-card admin-submissions">
      <div className="admin-section-heading">
        <div><p className="eyebrow">Private submissions</p><h2>Test-drive requests</h2></div>
        <span>Admin only</span>
      </div>
      {message && <p className="form-message">{message}</p>}
      <p>Requests are loaded in storage order; each page is sorted by date.</p>
      {cursor && <button className="button button-secondary" type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more requests"}</button>}
      <div className="submission-list">
        {items.map((item) => (
          <article className="submission-item" key={item.pathname}>
            {item.unreadable ? (
              <div><h3>Unreadable submission</h3><p>This record is retained, but its contents cannot be decrypted with the current encryption key.</p></div>
            ) : (
              <div><h3>{item.name}</h3><p>{item.vehicle} · {item.date} at {item.time}</p><p>{item.email} · {item.phone}</p>{item.notes && <p>{item.notes}</p>}</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
