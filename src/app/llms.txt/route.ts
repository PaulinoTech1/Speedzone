import { priceBrackets } from "@/lib/domain/price-brackets";
import { cachedPublishedVehicles } from "@/lib/server/public-inventory";

export const dynamic = "force-dynamic";

const origin = "https://www.speedzonems.com";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en-US");

// Follows the llms.txt convention (https://llmstxt.org): a concise, link-only
// Markdown index that AI assistants can fetch instead of crawling and
// rendering the full site to answer questions about it.
export async function GET(): Promise<Response> {
  const lines = [
    "# SpeedZone Motorsports",
    "",
    "> Independently owned used car dealership in Worcester, Massachusetts, selling affordable, quality-inspected vehicles since 2010. No-pressure sales.",
    "",
    "## Business information",
    "",
    "- Address: 1094 Main St, Worcester, MA 01603",
    "- Phone: (508) 826-9405",
    "- Email: smpaulino.business@gmail.com",
    "- Hours: Monday-Friday 10am-4pm, Saturday by appointment",
    "- Founded: 2010",
    "",
    "## Pages",
    "",
    `- [Home](${origin}/): Overview of SpeedZone Motorsports, hours, location, and why customers choose us.`,
    `- [Inventory](${origin}/inventory): Currently available used vehicles.`,
    `- [Request a test drive](${origin}/test-drive): Book a test drive online.`,
    `- [Sell or trade in your car](${origin}/sell-your-car): Get an offer, with VIN decoding to help identify your vehicle.`,
    `- [Used car taxes and fees in Massachusetts](${origin}/buying-costs): What sales tax, title, registration, and inspection actually add to the price, with a calculator.`,
    `- [Free VIN recall check](${origin}/recall-check): Look up NHTSA safety recall campaigns for any vehicle by VIN.`,
    `- [Cars under $5,000](${origin}/cars-under/5000): Budget inventory. Other brackets: ${priceBrackets
      .map((bracket) => `${origin}/cars-under/${bracket}`)
      .join(", ")}.`,
    `- [Road trip guide](${origin}/road-trip): Free and low-cost day trips from Worcester, Massachusetts.`,
    `- [Privacy](${origin}/privacy): Website privacy information.`,
    `- [Terms](${origin}/terms): Website terms of use.`,
  ];

  // A live-inventory fetch failure should never take down this file: an AI
  // agent should still get the business info and page links even if the
  // inventory store is unreachable.
  try {
    const vehicles = await cachedPublishedVehicles();
    if (vehicles.length > 0) {
      lines.push("", "## Current inventory", "");
      for (const vehicle of vehicles) {
        const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
        lines.push(
          `- [${name}](${origin}/inventory/${vehicle.slug}): ${usd.format(vehicle.price)}, ${number.format(vehicle.mileage)} miles, stock #${vehicle.stockNumber}.`,
        );
      }
    }
  } catch {
    console.error("llms.txt: inventory lookup failed, serving static content only");
  }

  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
