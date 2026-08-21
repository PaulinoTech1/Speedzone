import Image from "next/image";

import type { VehicleRecord } from "@/lib/domain/vehicle";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

export function VehicleCard({ vehicle }: { vehicle: VehicleRecord }) {
  const photo = vehicle.photographs[0];
  return (
    <article className="vehicle-card">
      <a className="vehicle-card-image" href={`/inventory/${vehicle.slug}`}>
        {photo ? (
          <Image
            src={photo.url}
            alt={photo.alt || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            width={photo.width}
            height={photo.height}
            sizes="(min-width: 64rem) 31vw, (min-width: 42rem) 48vw, 100vw"
          />
        ) : (
          <span>No photo yet</span>
        )}
      </a>
      <div className="vehicle-card-body">
        <p className="vehicle-stock">Stock {vehicle.stockNumber}</p>
        <h2>
          <a href={`/inventory/${vehicle.slug}`}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </a>
        </h2>
        {vehicle.trim ? <p className="vehicle-trim">{vehicle.trim}</p> : null}
        <dl className="vehicle-card-facts">
          <div>
            <dt>Price</dt>
            <dd>{usd.format(vehicle.price)}</dd>
          </div>
          <div>
            <dt>Mileage</dt>
            <dd>{number.format(vehicle.mileage)} mi</dd>
          </div>
        </dl>
        <a className="button button-primary vehicle-card-action" href={`/inventory/${vehicle.slug}`}>
          View vehicle
        </a>
      </div>
    </article>
  );
}
