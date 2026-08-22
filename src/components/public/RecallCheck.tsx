"use client";

import { useId, useState, type FormEvent } from "react";

import { recallCheckResponseSchema, type RecallCheckResponse } from "@/lib/domain/recall";
import { vinPattern } from "@/lib/domain/trade-in";

export function RecallCheck() {
  const formId = useId();
  const [vin, setVin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RecallCheckResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (checking) return;

    const candidate = vin.trim().toUpperCase();
    if (!vinPattern.test(candidate)) {
      setError("Enter a valid 17-character VIN");
      setResult(null);
      return;
    }

    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/recall-check?vin=${encodeURIComponent(candidate)}`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body) {
        setError(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            "We couldn't check that VIN right now. Please try again.",
        );
        return;
      }
      const parsed = recallCheckResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("We couldn't check that VIN right now. Please try again.");
        return;
      }
      setResult(parsed.data);
    } catch {
      setError("We couldn't reach the recall service. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  const vehicleName = result
    ? [result.vehicle.year, result.vehicle.make, result.vehicle.model].filter(Boolean).join(" ")
    : "";

  return (
    <div className="recall-tool">
      <form className="lead-form" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor={`${formId}-vin`}>
            Vehicle VIN <b aria-hidden="true">*</b>
          </label>
          <div className="vin-row">
            <input
              id={`${formId}-vin`}
              name="vin"
              type="text"
              maxLength={17}
              placeholder="17-character VIN"
              autoComplete="off"
              value={vin}
              onChange={(event) => {
                setVin(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${formId}-vin-error` : undefined}
              required
            />
            <button
              className="button button-primary vin-decode-button"
              type="submit"
              disabled={checking}
            >
              {checking ? "Checking…" : "Check recalls"}
            </button>
          </div>
          {error ? (
            <span className="field-error" id={`${formId}-vin-error`} role="alert">
              {error}
            </span>
          ) : null}
          <small>
            Your VIN is on your dashboard by the windshield, on the driver&rsquo;s door jamb, and on
            your registration.
          </small>
        </div>
      </form>

      {result ? (
        <section className="recall-results" aria-live="polite">
          <h2>
            {vehicleName}
            {result.vehicle.trim ? ` ${result.vehicle.trim}` : ""}
          </h2>

          {result.campaigns.length === 0 ? (
            <p className="recall-empty">
              NHTSA lists <strong>no recall campaigns</strong> for this year, make, and model.
            </p>
          ) : (
            <>
              <p className="recall-count">
                NHTSA lists <strong>{result.campaigns.length}</strong>{" "}
                {result.campaigns.length === 1 ? "recall campaign" : "recall campaigns"} for this
                year, make, and model.
              </p>
              <ul className="recall-list">
                {result.campaigns.map((campaign) => (
                  <li className="recall-item" key={campaign.campaignNumber}>
                    <div className="recall-item-head">
                      <h3>{campaign.component}</h3>
                      {campaign.parkIt ? (
                        <span className="recall-flag recall-flag-urgent">Do not drive</span>
                      ) : campaign.parkOutSide ? (
                        <span className="recall-flag recall-flag-urgent">Park outside</span>
                      ) : null}
                    </div>
                    <p className="recall-meta">
                      NHTSA campaign {campaign.campaignNumber}
                      {campaign.reportReceivedDate ? ` · ${campaign.reportReceivedDate}` : ""}
                    </p>
                    {campaign.summary ? <p>{campaign.summary}</p> : null}
                    {campaign.consequence ? (
                      <p className="recall-consequence">
                        <strong>Risk:</strong> {campaign.consequence}
                      </p>
                    ) : null}
                    {campaign.remedy ? (
                      <p className="recall-remedy">
                        <strong>Remedy:</strong> {campaign.remedy}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="recall-disclaimer">
            These are recall campaigns that affect this year, make, and model. They do{" "}
            <strong>not</strong> tell you whether this particular vehicle has already had the repair
            done — recalls are fixed free of charge by a franchised dealer, and many used cars have
            already been repaired. For a VIN-specific answer, use{" "}
            <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener noreferrer">
              NHTSA&rsquo;s official recall lookup
            </a>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}
