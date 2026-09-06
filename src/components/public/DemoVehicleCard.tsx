import Image from "next/image";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

/** A clearly labeled local preview used for the Civic proof of concept. */
export function DemoVehicleCard() {
  return (
    <article className="vehicle-card demo-vehicle-card">
      <div className="vehicle-card-image">
        <Image
          src="/inventory/10841-civic.webp"
          alt="2013 Honda Civic demo listing"
          width={450}
          height={600}
          sizes="(min-width: 64rem) 31vw, (min-width: 42rem) 48vw, 100vw"
        />
      </div>
      <div className="vehicle-card-body">
        <p className="vehicle-stock">Demo listing · Stock 10841</p>
        <h2>2013 Honda Civic</h2>
        <p className="vehicle-trim">VIN not provided for demo</p>
        <dl className="vehicle-card-facts">
          <div>
            <dt>Price</dt>
            <dd>{usd.format(7_995)}</dd>
          </div>
          <div>
            <dt>Mileage</dt>
            <dd>{number.format(157_000)} mi</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
