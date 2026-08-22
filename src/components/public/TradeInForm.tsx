"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import {
  tradeInConditionLabels,
  tradeInConditions,
  tradeInRequestSchema,
  vinDecodeResponseSchema,
  vinPattern,
  type DecodedVehicle,
  type TradeInCondition,
} from "@/lib/domain/trade-in";

type FormValues = {
  fullName: string;
  email: string;
  phone: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  engine: string;
  transmission: string;
  drivetrain: string;
  fuelType: string;
  mileage: string;
  condition: TradeInCondition | "";
  comments: string;
  website: string;
};

const emptyForm: FormValues = {
  fullName: "",
  email: "",
  phone: "",
  vin: "",
  year: "",
  make: "",
  model: "",
  trim: "",
  bodyStyle: "",
  engine: "",
  transmission: "",
  drivetrain: "",
  fuelType: "",
  mileage: "",
  condition: "",
  comments: "",
  website: "",
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;
type ToastState = { tone: "success" | "error"; message: string } | null;

function parsedSubmission(values: FormValues): Record<string, unknown> {
  return {
    ...values,
    year: values.year.trim() ? Number(values.year) : Number.NaN,
    mileage: values.mileage.trim() ? Number(values.mileage) : Number.NaN,
  };
}

function decodedSummary(vehicle: DecodedVehicle): string {
  const headline = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
  const details = [vehicle.bodyStyle, vehicle.engine, vehicle.transmission, vehicle.fuelType]
    .filter(Boolean)
    .join(" · ");
  return details ? `${headline} — ${details}` : headline;
}

export function TradeInForm() {
  const formId = useId();
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<{ summary: string; warning: string | null } | null>(null);
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

  async function decodeVin(): Promise<void> {
    const vin = values.vin.trim().toUpperCase();
    if (!vinPattern.test(vin)) {
      setErrors((current) => ({ ...current, vin: "Enter a valid 17-character VIN" }));
      return;
    }
    setDecoding(true);
    setDecoded(null);
    try {
      const response = await fetch(`/api/vin-decode?vin=${encodeURIComponent(vin)}`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body) {
        const message =
          (body as { error?: { message?: string } } | null)?.error?.message ??
          "That VIN couldn't be decoded. Double-check it or fill in the details manually.";
        showToast("error", message);
        return;
      }
      const parsed = vinDecodeResponseSchema.safeParse(body);
      if (!parsed.success) {
        showToast("error", "That VIN couldn't be decoded. Double-check it or fill in the details manually.");
        return;
      }
      const { vehicle, warning } = parsed.data;
      setValues((current) => ({
        ...current,
        year: vehicle.year ? String(vehicle.year) : current.year,
        make: vehicle.make ?? current.make,
        model: vehicle.model ?? current.model,
        trim: vehicle.trim ?? current.trim,
        bodyStyle: vehicle.bodyStyle ?? "",
        engine: vehicle.engine ?? "",
        transmission: vehicle.transmission ?? "",
        drivetrain: vehicle.drivetrain ?? "",
        fuelType: vehicle.fuelType ?? "",
      }));
      // These fields were just populated from the decode, so any earlier
      // "required" errors on them (from a prior failed submit) no longer apply.
      setErrors((current) => {
        const next = { ...current };
        if (vehicle.year) delete next.year;
        if (vehicle.make) delete next.make;
        if (vehicle.model) delete next.model;
        if (vehicle.trim) delete next.trim;
        return next;
      });
      setDecoded({ summary: decodedSummary(vehicle), warning });
    } catch {
      showToast("error", "We couldn't reach the vehicle lookup. Check your connection and try again.");
    } finally {
      setDecoding(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const result = tradeInRequestSchema.safeParse(parsedSubmission(values));
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
      const response = await fetch("/api/trade-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.data),
      });

      if (response.status === 201) {
        setValues(emptyForm);
        setDecoded(null);
        showToast(
          "success",
          "Thanks! We've got your vehicle details — we'll follow up with an offer or next steps shortly.",
        );
        return;
      }

      if (response.status === 429) {
        showToast(
          "error",
          "You've submitted a few requests already. Please call us at (508) 826-9405 directly.",
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

        <div className="lead-form-row">
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
        </div>

        <div className="field">
          <label htmlFor={`${formId}-vin`}>VIN (optional)</label>
          <div className="vin-row">
            <input
              id={`${formId}-vin`}
              name="vin"
              type="text"
              maxLength={17}
              placeholder="17-character VIN"
              autoComplete="off"
              value={values.vin}
              onChange={(event) => {
                update("vin", event.target.value);
                setDecoded(null);
              }}
              aria-invalid={Boolean(errors.vin)}
              aria-describedby={errors.vin ? `${formId}-vin-error` : undefined}
            />
            <button
              className="button button-ghost vin-decode-button"
              type="button"
              onClick={decodeVin}
              disabled={decoding}
            >
              {decoding ? "Decoding…" : "Decode VIN"}
            </button>
          </div>
          {errors.vin ? (
            <span className="field-error" id={`${formId}-vin-error`} role="alert">
              {errors.vin}
            </span>
          ) : null}
          {decoded ? (
            <p className="vin-decoded-summary">
              Decoded: <strong>{decoded.summary}</strong>
              {decoded.warning ? <span className="vin-decoded-warning"> {decoded.warning}</span> : null}
            </p>
          ) : null}
        </div>

        <div className="lead-form-row-thirds">
          <div className="field">
            <label htmlFor={`${formId}-year`}>
              Year <b aria-hidden="true">*</b>
            </label>
            <input
              id={`${formId}-year`}
              name="year"
              type="number"
              inputMode="numeric"
              min={1900}
              max={new Date().getFullYear() + 1}
              value={values.year}
              onChange={(event) => update("year", event.target.value)}
              aria-invalid={Boolean(errors.year)}
              aria-describedby={errors.year ? `${formId}-year-error` : undefined}
              required
            />
            {errors.year ? (
              <span className="field-error" id={`${formId}-year-error`} role="alert">
                {errors.year}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor={`${formId}-make`}>
              Make <b aria-hidden="true">*</b>
            </label>
            <input
              id={`${formId}-make`}
              name="make"
              type="text"
              value={values.make}
              onChange={(event) => update("make", event.target.value)}
              aria-invalid={Boolean(errors.make)}
              aria-describedby={errors.make ? `${formId}-make-error` : undefined}
              required
            />
            {errors.make ? (
              <span className="field-error" id={`${formId}-make-error`} role="alert">
                {errors.make}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor={`${formId}-model`}>
              Model <b aria-hidden="true">*</b>
            </label>
            <input
              id={`${formId}-model`}
              name="model"
              type="text"
              value={values.model}
              onChange={(event) => update("model", event.target.value)}
              aria-invalid={Boolean(errors.model)}
              aria-describedby={errors.model ? `${formId}-model-error` : undefined}
              required
            />
            {errors.model ? (
              <span className="field-error" id={`${formId}-model-error`} role="alert">
                {errors.model}
              </span>
            ) : null}
          </div>
        </div>

        <div className="lead-form-row">
          <div className="field">
            <label htmlFor={`${formId}-trim`}>Trim (optional)</label>
            <input
              id={`${formId}-trim`}
              name="trim"
              type="text"
              value={values.trim}
              onChange={(event) => update("trim", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={`${formId}-mileage`}>
              Mileage <b aria-hidden="true">*</b>
            </label>
            <input
              id={`${formId}-mileage`}
              name="mileage"
              type="number"
              inputMode="numeric"
              min={0}
              value={values.mileage}
              onChange={(event) => update("mileage", event.target.value)}
              aria-invalid={Boolean(errors.mileage)}
              aria-describedby={errors.mileage ? `${formId}-mileage-error` : undefined}
              required
            />
            {errors.mileage ? (
              <span className="field-error" id={`${formId}-mileage-error`} role="alert">
                {errors.mileage}
              </span>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-condition`}>
            Condition <b aria-hidden="true">*</b>
          </label>
          <select
            id={`${formId}-condition`}
            name="condition"
            value={values.condition}
            onChange={(event) => update("condition", event.target.value as TradeInCondition)}
            aria-invalid={Boolean(errors.condition)}
            aria-describedby={errors.condition ? `${formId}-condition-error` : undefined}
            required
          >
            <option value="" disabled>
              Choose a condition
            </option>
            {tradeInConditions.map((condition) => (
              <option key={condition} value={condition}>
                {tradeInConditionLabels[condition]}
              </option>
            ))}
          </select>
          {errors.condition ? (
            <span className="field-error" id={`${formId}-condition-error`} role="alert">
              {errors.condition}
            </span>
          ) : null}
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
          {submitting ? "Sending…" : "Get my offer"}
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
