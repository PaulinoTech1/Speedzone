import { NextRequest } from "next/server";
import { put } from "@vercel/blob";

import {
  testDriveRequestSchema,
  testDriveTimeSlotLabels,
  type TestDriveRequest,
} from "@/lib/domain/test-drive";
import { renderLeadEmail, sendLeadNotification } from "@/lib/server/lead-email";
import { leadBlobStoreId, leadBlobToken, leadNotificationConfig, tokenConfig } from "@/lib/server/env";
import { noStoreJson, parseStrictJsonBody, RequestValidationError } from "@/lib/server/request";
import { enforceClientRateLimit, routeError } from "@/lib/server/route-utils";
import { clientSecurityHash, logSecurityEvent } from "@/lib/server/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumBodyBytes = 8 * 1024;

function notificationEmail(request: TestDriveRequest): { text: string; html: string } {
  const rows: [string, string][] = [
    ["Full name", request.fullName],
    ["Email", request.email],
    ["Phone", request.phone],
    ["Vehicle of interest", request.vehicleOfInterest],
  ];
  if (request.preferredDate) rows.push(["Preferred date", request.preferredDate]);
  if (request.preferredTime) {
    rows.push(["Preferred time", testDriveTimeSlotLabels[request.preferredTime]]);
  }
  return renderLeadEmail("New Test Drive Request", rows, request.comments);
}

async function storeRequest(request: TestDriveRequest): Promise<void> {
  let storeId: string;
  let token: string;
  try {
    storeId = leadBlobStoreId();
    token = leadBlobToken();
  } catch {
    throw new RequestValidationError("Request storage is unavailable", 503, "TD_STORAGE_CONFIG");
  }
  try {
    await put(
      `leads/test-drive/${crypto.randomUUID()}.json`,
      JSON.stringify({
        type: "test-drive-request",
        submittedAt: new Date().toISOString(),
        ...request,
      }),
      {
        access: "private",
        contentType: "application/json",
        storeId,
        token,
      },
    );
  } catch {
    // Never expose provider errors: they may contain credentials or lead data.
    throw new RequestValidationError("Request storage is unavailable", 503, "TD_STORAGE_WRITE");
  }
}

export async function POST(request: NextRequest) {
  try {
    try {
      tokenConfig();
    } catch (error) {
      // Only fixed codes leave the server; never return the original message.
      const message = error instanceof Error ? error.message : "";
      const code = message.includes("AUTH_COOKIE_SECRET") && !message.startsWith("ADMIN_PASSWORD_PEPPER")
        ? "TD_COOKIE_CONFIG"
        : message.startsWith("ADMIN_PASSWORD_PEPPER")
          ? "TD_PEPPER_CONFIG"
          : "TD_SECURITY_CONFIG";
      throw new RequestValidationError("Request service is unavailable", 503, code);
    }
    enforceClientRateLimit(request, "testDrive");
    const input = await parseStrictJsonBody(request, testDriveRequestSchema, maximumBodyBytes);
    await storeRequest(input);
    const { resendApiKey, fromEmail } = leadNotificationConfig();
    if (resendApiKey && fromEmail) {
      const { text, html } = notificationEmail(input);
      await sendLeadNotification({
        subject: `New Test Drive Request - ${input.fullName}`,
        replyTo: input.email,
        text,
        html,
      });
    }
    logSecurityEvent({
      event: "test_drive.submitted",
      outcome: "success",
      clientHash: clientSecurityHash(request),
    });
    return noStoreJson({ ok: true }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
