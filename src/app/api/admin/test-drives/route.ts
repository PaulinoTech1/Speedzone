import { withDiagnostics } from "@/lib/diagnostics";
import { get, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import type { TestDriveSubmission } from "@/app/api/test-drive/route";
import { isAdmin, privateResponseHeaders } from "@/lib/admin-auth";
import { decryptTestDrivePayload } from "@/lib/test-drive-crypto";

const token = () => process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN;

async function diagnosedGET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const privateToken = token();
  if (!privateToken) return NextResponse.json({ error: "Test-drive storage is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const pathname = url.searchParams.get("pathname");
  try {
    if (pathname) {
      const result = await get(pathname, { access: "private", token: privateToken });
      if (!result) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
      const encrypted = await new Response(result.stream).text();
      try {
        const submission = await decryptTestDrivePayload<TestDriveSubmission>(encrypted);
        return NextResponse.json(submission, { headers: privateResponseHeaders() });
      } catch {
        return NextResponse.json({ error: "Submission is unreadable" }, { status: 422, headers: privateResponseHeaders() });
      }
    }
    const cursor = url.searchParams.get("cursor") || undefined;
    if (cursor && cursor.length > 2048) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    const { blobs, cursor: nextCursor, hasMore } = await list({ prefix: "test-drive/", token: privateToken, limit: 20, cursor });
    const submissions = await Promise.all(blobs.map(async (blob) => {
      try {
      const result = await get(blob.pathname, { access: "private", token: privateToken });
      if (!result) return null;
      const encrypted = await new Response(result.stream).text();
      try {
        const submission = await decryptTestDrivePayload<TestDriveSubmission>(encrypted);
        return { ...submission, pathname: blob.pathname };
      } catch {
        return { pathname: blob.pathname, unreadable: true };
      }
      } catch { return { pathname: blob.pathname, unreadable: true }; }
    }));
    return NextResponse.json(
      submissions
        .filter((submission) => submission !== null)
        .sort((a, b) => ("createdAt" in b ? b.createdAt : "").localeCompare("createdAt" in a ? a.createdAt : "")),
      { headers: { ...privateResponseHeaders(), ...(hasMore && nextCursor ? { "x-next-cursor": nextCursor } : {}) } },
    );
  } catch (error) {
    console.error("[v0] test-drive admin read failed", error);
    return NextResponse.json({ error: "Unable to load test-drive requests" }, { status: 500 });
  }
}

export async function GET(request: Request) { return withDiagnostics("CUSTOMER_REQUEST_INBOX_READ", () => diagnosedGET(request)); }
