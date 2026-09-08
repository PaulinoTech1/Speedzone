import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

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
  const submission: TestDriveSubmission = {
    id: crypto.randomUUID(),
    name: clean(form.get("name")),
    email: clean(form.get("email")),
    phone: clean(form.get("phone")),
    vehicle: clean(form.get("vehicle")),
    date: clean(form.get("date")),
    time: clean(form.get("time")),
    notes: clean(form.get("notes")),
    createdAt: new Date().toISOString(),
  };

  if (!submission.name || !submission.email || !submission.phone || !submission.vehicle || !submission.date || !submission.time) {
    return NextResponse.json({ error: "Please complete all required fields." }, { status: 400 });
  }

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
