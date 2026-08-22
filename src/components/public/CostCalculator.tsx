"use client";

import { useId, useMemo, useState } from "react";

import { estimateUpfrontCost, massachusettsFees } from "@/lib/domain/ownership-costs";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function CostCalculator() {
  const fieldId = useId();
  const [price, setPrice] = useState("3500");

  const breakdown = useMemo(() => estimateUpfrontCost(Number(price)), [price]);
  const taxPercent = (massachusettsFees.salesTaxRate * 100).toFixed(2).replace(/\.00$/, "");

  return (
    <div className="cost-calculator">
      <div className="field">
        <label htmlFor={`${fieldId}-price`}>Vehicle price</label>
        <input
          id={`${fieldId}-price`}
          name="price"
          type="number"
          inputMode="numeric"
          min={0}
          step={100}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>

      <table className="cost-table">
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
      </table>

      <p className="cost-note">
        Estimate only, based on published Massachusetts rates. Your city or town also bills motor
        vehicle excise tax separately each year. Plate transfers, specialty plates, and insurance
        are not included.
      </p>
    </div>
  );
}
