import { get, list } from "@vercel/blob";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { TestDriveSubmission } from "@/app/api/test-drive/route";

const token = () => process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN;
async function isAdmin() { return (await cookies()).get("speedzone_admin")?.value === "authenticated"; }

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
      return new NextResponse(result.stream, { headers: { "Content-Type": result.blob.contentType || "application/json", "Content-Disposition": `attachment; filename="${pathname.split("/").pop() || "test-drive.json"}"` } });
    }
    const { blobs } = await list({ prefix: "test-drive/", token: privateToken, limit: 100 });
    const submissions = await Promise.all(blobs.map(async (blob) => {
      const result = await get(blob.pathname, { access: "private", token: privateToken });
      if (!result) return null;
      return { ...(await new Response(result.stream).json() as TestDriveSubmission), pathname: blob.pathname };
    }));
    return NextResponse.json(submissions.filter(Boolean).sort((a, b) => String(b?.createdAt).localeCompare(String(a?.createdAt))));
  } catch (error) {
    console.error("[v0] test-drive admin read failed", error);
    return NextResponse.json({ error: "Unable to load test-drive requests" }, { status: 500 });
  }
}
