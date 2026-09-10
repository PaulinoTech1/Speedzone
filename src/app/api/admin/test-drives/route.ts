import { get, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import type { TestDriveSubmission } from "@/app/api/test-drive/route";
import { isAdmin, privateResponseHeaders } from "@/lib/admin-auth";
import { decryptTestDrivePayload } from "@/lib/test-drive-crypto";

const token = () => process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN;

export async function GET(request: Request) {
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
    const { blobs } = await list({ prefix: "test-drive/", token: privateToken, limit: 100 });
    const submissions = await Promise.all(blobs.map(async (blob) => {
      const result = await get(blob.pathname, { access: "private", token: privateToken });
      if (!result) return null;
      const encrypted = await new Response(result.stream).text();
      try {
        const submission = await decryptTestDrivePayload<TestDriveSubmission>(encrypted);
        return { ...submission, pathname: blob.pathname };
      } catch {
        return { pathname: blob.pathname, unreadable: true };
      }
    }));
    return NextResponse.json(
      submissions.sort((a, b) => String((b as { createdAt?: string }).createdAt ?? "").localeCompare(String((a as { createdAt?: string }).createdAt ?? ""))),
      { headers: privateResponseHeaders() },
    );
  } catch (error) {
    console.error("[v0] test-drive admin read failed", error);
    return NextResponse.json({ error: "Unable to load test-drive requests" }, { status: 500 });
  }
}
