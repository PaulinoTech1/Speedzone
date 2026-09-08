export const appointmentTimes = ["10:00 AM", "11:30 AM", "1:00 PM", "2:30 PM", "4:00 PM"] as const;

export type TestDriveFields = {
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  date: string;
  time: string;
  notes: string;
  turnstileToken?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string) {
  return /^[+\d][\d\s().-]{6,}$/.test(value);
}

export function validateTestDriveFields(fields: TestDriveFields) {
  const required: Array<keyof Pick<TestDriveFields, "name" | "email" | "phone" | "vehicle" | "date" | "time">> = [
    "name",
    "email",
    "phone",
    "vehicle",
    "date",
    "time",
  ];

  if (required.some((field) => !fields[field])) return "Please complete all required fields.";
  if (fields.name.length > 100 || fields.vehicle.length > 160 || fields.notes.length > 1000) {
    return "Please shorten one or more fields and try again.";
  }
  if (!isValidEmail(fields.email) || fields.email.length > 254) return "Enter a valid email address.";
  if (!isValidPhone(fields.phone) || fields.phone.length > 30) return "Enter a valid phone number.";
  if (!appointmentTimes.includes(fields.time as (typeof appointmentTimes)[number])) return "Please choose an available appointment time.";

  const selectedDate = new Date(`${fields.date}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) return "Choose a future appointment date.";
  if (selectedDate.getDay() === 0) return "Sunday appointments are unavailable. Please choose another day.";

  return null;
}

export function normalizeTestDriveField(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export function getTestDriveFields(form: FormData): TestDriveFields {
  return {
    name: normalizeTestDriveField(form.get("name")),
    email: normalizeTestDriveField(form.get("email")).toLowerCase(),
    phone: normalizeTestDriveField(form.get("phone")),
    vehicle: normalizeTestDriveField(form.get("vehicle")),
    date: normalizeTestDriveField(form.get("date")),
    time: normalizeTestDriveField(form.get("time")),
    notes: normalizeTestDriveField(form.get("notes")),
    turnstileToken: normalizeTestDriveField(form.get("cf-turnstile-response")),
  };
}
