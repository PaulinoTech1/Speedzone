import Link from "next/link";
import { headers } from "next/headers";

import { readBugReportsPage, type BugReport } from "@/lib/bug-reports";
import { recordConsoleAudit } from "@/lib/security-console/console-audit";
import { requireMfa } from "@/lib/security-console/guards";

export const dynamic = "force-dynamic";

type VisibleReport = BugReport & { status: "new"; severity: "high" | "medium" | "low"; expiresAt: string };
type ReportRow = VisibleReport | { id: string; unreadable: true };

function visibleReport(report: BugReport): VisibleReport {
  return {
    ...report,
    status: "new",
    severity: report.category === "security" ? "high" : report.category === "accessibility" ? "medium" : "low",
    expiresAt: new Date(Date.parse(report.createdAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await requireMfa();
  const rawCursor = (await searchParams).cursor || "0";
  const cursor = /^\d{1,4}$/.test(rawCursor) ? Number(rawCursor) : 0;
  let reports: ReportRow[] = [];
  let nextCursor: number | null = null;
  let unavailable = false;

  try {
    const page = await readBugReportsPage(cursor, 50);
    reports = page.reports.map((report) => "unreadable" in report ? report : visibleReport(report));
    nextCursor = page.nextCursor;
    await recordConsoleAudit(new Request("https://console.local/reports", { headers: await headers() }), "console.report", "allowed", "report_page_viewed");
  } catch {
    unavailable = true;
  }

  return (
    <main>
      <header>
        <div><p className="eyebrow">Operations</p><h1>Bug and security reports</h1><p className="muted">Encrypted reports are decrypted only on the server after console authentication.</p></div>
        <Link href="/Security_Console#reports">Back to headquarters</Link>
      </header>
      <section className="panel section">
        {unavailable ? <p className="danger">The report source is unavailable or not configured.</p> : reports.length === 0 ? <p className="muted">No reports are available on this page.</p> : (
          <div className="report-list">{reports.map((report) => (
            <article className="panel" key={report.id}>{"unreadable" in report ? <><h2>Unreadable report</h2><p className="mono">{report.id}</p></> : <>
              <div className="event"><div><span className={`badge ${report.severity === "high" ? "danger" : ""}`}>{report.severity}</span><h2>{report.title}</h2></div><span className="badge">{report.status}</span></div>
              <p className="muted">{report.category} · submitted {new Date(report.createdAt).toLocaleString()} · expires {new Date(report.expiresAt).toLocaleDateString()}</p>
              <details><summary>View report details</summary><p>{report.details}</p><dl><dt>Page</dt><dd>{report.page || "Not supplied"}</dd><dt>Contact</dt><dd>{report.contact || "Not supplied"}</dd><dt>Reference</dt><dd className="mono">{report.reference || "Not supplied"}</dd><dt>Report ID</dt><dd className="mono">{report.id}</dd></dl></details>
            </>}</article>
          ))}</div>
        )}
        {!unavailable && <nav className="pagination">{cursor > 0 && <Link className="text-link" href={`/Security_Console/reports?cursor=${Math.max(0, cursor - 50)}`}>Previous</Link>}{nextCursor !== null && <Link className="text-link" href={`/Security_Console/reports?cursor=${nextCursor}`}>Next</Link>}</nav>}
      </section>
    </main>
  );
}
