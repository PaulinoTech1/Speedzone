"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import {
  testDriveRequestSchema,
  testDriveTimeSlotLabels,
  testDriveTimeSlots,
  type TestDriveTimeSlot,
} from "@/lib/domain/test-drive";

type FormValues = {
  fullName: string;
  email: string;
  phone: string;
  vehicleOfInterest: string;
  preferredDate: string;
  preferredTime: TestDriveTimeSlot | "";
  comments: string;
  website: string;
};

const emptyForm: FormValues = {
  fullName: "",
  email: "",
  phone: "",
  vehicleOfInterest: "",
  preferredDate: "",
  preferredTime: "",
  comments: "",
  website: "",
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;
type ToastState = { tone: "success" | "error"; message: string } | null;

function localDateISO(date = new Date()): string {
  const localMidnight = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localMidnight.toISOString().slice(0, 10);
}

export function TestDriveForm() {
  const formId = useId();
  const today = localDateISO();
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function showToast(tone: "success" | "error", message: string): void {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ tone, message });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const result = testDriveRequestSchema.safeParse(values);
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FormValues | undefined;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      showToast("error", "Please fix the highlighted fields and try again.");
      return;
    }

    setSubmitting(true);
    setErrors({});
    try {
      const response = await fetch("/api/test-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.data),
      });

      if (response.status === 201) {
        setValues(emptyForm);
        showToast(
          "success",
          "Thanks! Your test drive request is in — we'll call or email you shortly to confirm.",
        );
        return;
      }

      if (response.status === 429) {
        showToast(
          "error",
          "You've submitted a few requests already. Please call us at (508) 826-9405 to book directly.",
        );
        return;
      }

      showToast(
        "error",
        "We couldn't send your request. Please try again, or call us at (508) 826-9405.",
      );
    } catch {
      showToast(
        "error",
        "We couldn't reach the server. Check your connection and try again, or call us at (508) 826-9405.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lead-form-wrap">
      <form className="lead-form" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor={`${formId}-fullName`}>
            Full name <b aria-hidden="true">*</b>
          </label>
          <input
            id={`${formId}-fullName`}
            name="fullName"
            type="text"
            autoComplete="name"
            value={values.fullName}
            onChange={(event) => update("fullName", event.target.value)}
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? `${formId}-fullName-error` : undefined}
            required
          />
          {errors.fullName ? (
            <span className="field-error" id={`${formId}-fullName-error`} role="alert">
              {errors.fullName}
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor={`${formId}-email`}>
            Email address <b aria-hidden="true">*</b>
          </label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? `${formId}-email-error` : undefined}
            required
          />
          {errors.email ? (
            <span className="field-error" id={`${formId}-email-error`} role="alert">
              {errors.email}
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor={`${formId}-phone`}>
            Phone number <b aria-hidden="true">*</b>
          </label>
          <input
            id={`${formId}-phone`}
            name="phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? `${formId}-phone-error` : undefined}
            required
          />
          {errors.phone ? (
            <span className="field-error" id={`${formId}-phone-error`} role="alert">
              {errors.phone}
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor={`${formId}-vehicle`}>
            Vehicle of interest <b aria-hidden="true">*</b>
          </label>
          <input
            id={`${formId}-vehicle`}
            name="vehicleOfInterest"
            type="text"
            placeholder={'e.g. 2021 Ford Mustang GT, or "not sure yet"'}
            value={values.vehicleOfInterest}
            onChange={(event) => update("vehicleOfInterest", event.target.value)}
            aria-invalid={Boolean(errors.vehicleOfInterest)}
            aria-describedby={errors.vehicleOfInterest ? `${formId}-vehicle-error` : undefined}
            required
          />
          {errors.vehicleOfInterest ? (
            <span className="field-error" id={`${formId}-vehicle-error`} role="alert">
              {errors.vehicleOfInterest}
            </span>
          ) : null}
        </div>

        <div className="lead-form-row">
          <div className="field">
            <label htmlFor={`${formId}-date`}>
              Preferred date <b aria-hidden="true">*</b>
            </label>
            <input
              id={`${formId}-date`}
              name="preferredDate"
              type="date"
              min={today}
              value={values.preferredDate}
              onChange={(event) => update("preferredDate", event.target.value)}
              aria-invalid={Boolean(errors.preferredDate)}
              aria-describedby={errors.preferredDate ? `${formId}-date-error` : undefined}
              required
            />
            {errors.preferredDate ? (
              <span className="field-error" id={`${formId}-date-error`} role="alert">
                {errors.preferredDate}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor={`${formId}-time`}>
              Preferred time <b aria-hidden="true">*</b>
            </label>
            <select
              id={`${formId}-time`}
              name="preferredTime"
              value={values.preferredTime}
              onChange={(event) => update("preferredTime", event.target.value as TestDriveTimeSlot)}
              aria-invalid={Boolean(errors.preferredTime)}
              aria-describedby={errors.preferredTime ? `${formId}-time-error` : undefined}
              required
            >
              <option value="" disabled>
                Choose a time
              </option>
              {testDriveTimeSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {testDriveTimeSlotLabels[slot]}
                </option>
              ))}
            </select>
            {errors.preferredTime ? (
              <span className="field-error" id={`${formId}-time-error`} role="alert">
                {errors.preferredTime}
              </span>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-comments`}>Comments or questions</label>
          <textarea
            id={`${formId}-comments`}
            name="comments"
            rows={4}
            value={values.comments}
            onChange={(event) => update("comments", event.target.value)}
            aria-invalid={Boolean(errors.comments)}
            aria-describedby={errors.comments ? `${formId}-comments-error` : undefined}
          />
          {errors.comments ? (
            <span className="field-error" id={`${formId}-comments-error`} role="alert">
              {errors.comments}
            </span>
          ) : null}
        </div>

        <div className="lead-honeypot" aria-hidden="true">
          <label htmlFor={`${formId}-website`}>Leave this field empty</label>
          <input
            id={`${formId}-website`}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(event) => update("website", event.target.value)}
          />
        </div>

        <button className="button button-primary lead-submit" type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Request test drive"}
        </button>
      </form>

      {toast ? (
        <div
          className={`form-toast form-toast-${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            &times;
          </button>
        </div>
      ) : null}
    </div>
  );
}
