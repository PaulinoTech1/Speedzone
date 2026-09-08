import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getTestDriveFields, validateTestDriveFields } from "@/lib/test-drive-validation";

const privateToken = () => process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN;

export type TestDriveSubmission = {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  date: string;
  time: string;
  notes: string;
  createdAt: string;
};

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  const token = privateToken();
  if (!token) return NextResponse.json({ error: "Test-drive storage is not configured" }, { status: 503 });

  const form = await request.formData();
  const fields = getTestDriveFields(form);
  const validationError = validateTestDriveFields(fields);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const submission: TestDriveSubmission = {
    id: crypto.randomUUID(),
    ...fields,
    createdAt: new Date().toISOString(),
  };

  try {
    await put(`test-drive/${submission.createdAt.slice(0, 10)}/${submission.id}.json`, JSON.stringify(submission), {
      access: "private",
      token,
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[v0] test-drive submission failed", error);
    return NextResponse.json({ error: "Unable to submit your request right now." }, { status: 500 });
  }
}
