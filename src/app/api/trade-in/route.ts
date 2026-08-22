import { NextRequest } from "next/server";

import { tradeInConditionLabels, tradeInRequestSchema, type TradeInRequest } from "@/lib/domain/trade-in";
import { renderLeadEmail, sendLeadNotification } from "@/lib/server/lead-email";
import { noStoreJson, parseStrictJsonBody } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { clientSecurityHash, logSecurityEvent } from "@/lib/server/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumBodyBytes = 8 * 1024;

function notificationEmail(request: TradeInRequest): { text: string; html: string } {
  const vehicleParts = [request.year, request.make, request.model, request.trim]
    .filter(Boolean)
    .join(" ");
  const rows: [string, string][] = [
    ["Full name", request.fullName],
    ["Email", request.email],
    ["Phone", request.phone],
    ["Vehicle", vehicleParts],
    ["VIN", request.vin || "(not provided)"],
    ["Mileage", `${new Intl.NumberFormat("en-US").format(request.mileage)} mi`],
    ["Condition", tradeInConditionLabels[request.condition]],
  ];
  const decoded: [string, string][] = [
    ["Body style", request.bodyStyle],
    ["Engine", request.engine],
    ["Transmission", request.transmission],
    ["Drivetrain", request.drivetrain],
    ["Fuel type", request.fuelType],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return renderLeadEmail("New Sell/Trade-In Request", [...rows, ...decoded], request.comments);
}

export async function POST(request: NextRequest) {
  try {
    enforceClientRateLimit(request, "tradeIn");
    const input = await parseStrictJsonBody(request, tradeInRequestSchema, maximumBodyBytes);
    const { text, html } = notificationEmail(input);
    await sendLeadNotification({
      subject: `New Sell/Trade-In Request - ${input.fullName}`,
      replyTo: input.email,
      text,
      html,
    });
    logSecurityEvent({
      event: "trade_in.submitted",
      outcome: "success",
      clientHash: clientSecurityHash(request),
    });
    return noStoreJson({ ok: true }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
