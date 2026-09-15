"use client";

import { useId, useState } from "react";

import { estimateUpfrontCost, massachusettsFees } from "@/lib/domain/ownership-costs";
import { calculateMonthlyPayment, parseCalculatorInput } from "@/lib/domain/monthly-payment";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function CostCalculator() {
  const fieldId = useId();
  const [price, setPrice] = useState("3500");
  const [downPayment, setDownPayment] = useState("0");
  const [term, setTerm] = useState("60");
  const [apr, setApr] = useState("6.00");

  const parsedPrice = parseCalculatorInput(price, "money");
  const parsedDown = parseCalculatorInput(downPayment, "money");
  const parsedTerm = parseCalculatorInput(term, "term");
  const parsedApr = parseCalculatorInput(apr, "apr");
  const breakdown = parsedPrice.error === undefined ? estimateUpfrontCost(parsedPrice.value) : null;
  const downError = parsedDown.error ?? (breakdown && parsedDown.value! > breakdown.total ? "Down payment cannot exceed the estimated total." : undefined);
  const monthly = breakdown && !downError && parsedDown.value !== undefined && parsedTerm.value !== undefined && parsedApr.value !== undefined
    ? calculateMonthlyPayment(breakdown.total, parsedDown.value, parsedTerm.value, parsedApr.value) : null;
  const taxPercent = (massachusettsFees.salesTaxRate * 100).toFixed(2).replace(/\.00$/, "");

  return (
    <div className="cost-calculator">
      <div className="field">
        <label htmlFor={`${fieldId}-price`}>Vehicle price</label>
        <input
          id={`${fieldId}-price`}
          name="price"
          type="text"
          inputMode="decimal"
          maxLength={32}
          aria-invalid={!!parsedPrice.error}
          aria-describedby={parsedPrice.error ? `${fieldId}-price-error` : undefined}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        {parsedPrice.error && <p id={`${fieldId}-price-error`} role="alert">{parsedPrice.error}</p>}
      </div>

      {breakdown && <table className="cost-table">
        <caption className="visually-hidden">
          Estimated Massachusetts up-front costs for the entered vehicle price
        </caption>
        <tbody>
          <tr>
            <th scope="row">Vehicle price</th>
            <td>{usd.format(breakdown.price)}</td>
          </tr>
          <tr>
            <th scope="row">Sales tax ({taxPercent}%)</th>
            <td>{usd.format(breakdown.salesTax)}</td>
          </tr>
          <tr>
            <th scope="row">Title</th>
            <td>{usd.format(breakdown.titleFee)}</td>
          </tr>
          <tr>
            <th scope="row">Registration (2 years)</th>
            <td>{usd.format(breakdown.registrationFee)}</td>
          </tr>
          <tr>
            <th scope="row">State inspection</th>
            <td>{usd.format(breakdown.inspectionFee)}</td>
          </tr>
          <tr>
            <th scope="row">Dealer documentation fee</th>
            <td>{usd.format(breakdown.documentationFee)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="cost-row-subtotal">
            <th scope="row">Added on top</th>
            <td>{usd.format(breakdown.feesSubtotal)}</td>
          </tr>
          <tr className="cost-row-total">
            <th scope="row">Estimated total</th>
            <td>{usd.format(breakdown.total)}</td>
          </tr>
        </tfoot>
      </table>}

      <p className="cost-note">
        Estimate only, based on published Massachusetts rates. Your city or town also bills motor
        vehicle excise tax separately each year. Plate transfers, specialty plates, and insurance
        are not included.
      </p>
      <section className="monthly-payment-calculator" aria-labelledby={`${fieldId}-monthly-heading`}>
        <h2 id={`${fieldId}-monthly-heading`}>Monthly payment calculator</h2>
        <p className="cost-note">Uses the vehicle price and estimated taxes and fees above. Enter your down payment, term in months, and annual percentage rate (APR).</p>
        {([
          { key: "down", label: "Down payment", value: downPayment, set: setDownPayment, error: downError },
          { key: "term", label: "Term length (months)", value: term, set: setTerm, error: parsedTerm.error },
          { key: "apr", label: "APR (%)", value: apr, set: setApr, error: parsedApr.error },
        ]).map((field) => (
          <div className="field" key={field.key}>
            <label htmlFor={`${fieldId}-${field.key}`}>{field.label}</label>
            <input id={`${fieldId}-${field.key}`} type="text" inputMode={field.key === "term" ? "numeric" : "decimal"}
              maxLength={32} value={field.value} aria-invalid={!!field.error}
              aria-describedby={field.error ? `${fieldId}-${field.key}-error` : undefined}
              onChange={(event) => {
                const value = event.target.value;
                if (field.key === "apr" && /\.\d{3}/.test(value)) return;
                field.set(value);
              }} />
            {field.error && <p id={`${fieldId}-${field.key}-error`} role="alert">{field.error}</p>}
          </div>
        ))}
        <p className="monthly-payment-result" aria-live="polite">
          {monthly === null ? "Enter valid values to see your monthly payment." : `Estimated monthly payment: ${monthly.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
        </p>
        <p className="cost-note">Estimate only. Actual payment depends on lender terms and approval.</p>
      </section>
    </div>
  );
}
