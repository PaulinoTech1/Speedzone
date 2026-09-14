import type { Metadata } from "next";
import { LegalHeader, LegalFooter } from "@/components/public/SiteChrome";
import { BugReportForm } from "@/components/public/BugReportForm";

export const metadata: Metadata = { title: "Report a website problem", robots: { index: false, follow: true } };
export default function ReportProblemPage() {
  return <><LegalHeader /><main className="shell legal-main" id="main"><h1>Report a website problem</h1><p>Describe the problem, the affected page, and the smallest set of steps needed to reproduce it.</p><h2>Responsible security reporting</h2><p>If you notice a security issue, stop testing when you have enough information to describe it. Do not access other people&apos;s data, change or delete records, disrupt services, or run automated scans. This page does not authorize security testing or promise a reward. Keep details private while we review your report.</p><p>Text only, up to 8 KB per request. To prevent abuse, reporting is limited to two attempts per hour and five per day per client, with additional site-wide limits. People sharing a network may share a limit.</p><BugReportForm /></main><LegalFooter counterpart="privacy" /></>;
}
