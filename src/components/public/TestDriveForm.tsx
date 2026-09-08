"use client";

import { FormEvent, useMemo, useState } from "react";
import { getTestDriveFields, validateTestDriveFields } from "@/lib/test-drive-validation";

const hours = [
  ["Monday–Friday", "10:00 AM–4:00 PM"],
  ["Saturday", "By appointment"],
  ["Sunday", "Closed"],
];

export function TestDriveForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const minDate = useMemo(() => new Date().toISOString().split("T")[0], []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const validationError = validateTestDriveFields(getTestDriveFields(form));

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    const response = await fetch("/api/test-drive", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(
        response.status === 429
          ? "Too many requests from this contact. Please try again later."
          : result.error || "Unable to submit your request right now.",
      );
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <section className="form-success" aria-live="polite">
        <p className="eyebrow">Request received</p>
        <h2>We&apos;ll confirm your drive.</h2>
        <p>
          Thanks for reaching out. A SpeedZone team member will contact you to
          confirm availability and your appointment time.
        </p>
        <a className="button button-primary" href="/inventory">
          Browse inventory
        </a>
      </section>
    );
  }

  return (
    <form className="test-drive-form" onSubmit={handleSubmit}>
      <div className="form-section-heading">
        <p className="eyebrow">Your details</p>
        <h2>Tell us how to reach you</h2>
      </div>
      <div className="form-grid">
        <label
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            width: 1,
            height: 1,
            overflow: "hidden",
          }}
        >
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
        <label>
          Full name
          <input name="name" required autoComplete="name" />
        </label>
        <label>
          Email address
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Phone number
          <input name="phone" type="tel" required autoComplete="tel" />
        </label>
        <label>
          Vehicle of interest
          <input name="vehicle" required placeholder="Year, make, and model" />
        </label>
        <label>
          Preferred date
          <input
            name="date"
            type="date"
            required
            min={minDate}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          Preferred time
          <select name="time" required defaultValue="">
            <option value="" disabled>
              Select a time
            </option>
            <option>10:00 AM</option>
            <option>11:30 AM</option>
            <option>1:00 PM</option>
            <option>2:30 PM</option>
            <option>4:00 PM</option>
          </select>
        </label>
      </div>
      <label>
        Notes <span>(optional)</span>
        <textarea name="notes" rows={4} placeholder="Anything we should know?" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="form-disclaimer">
        This request does not guarantee an appointment. We&apos;ll confirm the
        vehicle and time with you before your visit.
      </p>
      <button className="button button-primary" type="submit">
        Request a test drive
      </button>
    </form>
  );
}

export { hours };
