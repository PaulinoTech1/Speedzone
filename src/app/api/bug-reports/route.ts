import { admitBugReport, readReportBody, storeBugReport, validReportOrigin, validateBugReport } from "@/lib/bug-reports";
import { withDiagnostics } from "@/lib/diagnostics";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return withDiagnostics("RESPONSIBLE_BUG_REPORT_ACCEPT", async () => {
    if (!validReportOrigin(request)) return Response.json({ error: "Please submit from the website report form." }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return Response.json({ error: "JSON required." }, { status: 415 });
    let retry: number;
    try { retry = await admitBugReport(request); } catch { return Response.json({ error: "Reporting temporarily unavailable." }, { status: 503 }); }
    if (retry > 0) return Response.json({ error: "Too many reports. Please try again later." }, { status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" } });
    let body: unknown;
    try { body = await readReportBody(request); } catch (error) { return Response.json({ error: "Report is invalid or too large." }, { status: error instanceof RangeError ? 413 : 400 }); }
    const report = validateBugReport(body);
    if (!report) return Response.json({ error: "Check the report fields and their length limits." }, { status: 400 });
    const reference = await storeBugReport(report);
    await writeSecurityEvent({ ...securityRequestContext(request), event: "bug-report.submission", outcome: "allowed", actor: "anonymous", reason: "encrypted_report_stored", metadata: { report_category: report.category } });
    return Response.json({ ok: true, reference }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
