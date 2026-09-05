import { NextRequest } from "next/server";
import { put } from "@vercel/blob";

import {
  testDriveRequestSchema,
  testDriveTimeSlotLabels,
  type TestDriveRequest,
} from "@/lib/domain/test-drive";
import { renderLeadEmail, sendLeadNotification } from "@/lib/server/lead-email";
import { leadBlobStoreId, leadBlobToken, leadNotificationConfig } from "@/lib/server/env";
import { noStoreJson, parseStrictJsonBody } from "@/lib/server/request";
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
      storeId: leadBlobStoreId(),
      token: leadBlobToken(),
    },
  );
}

export async function POST(request: NextRequest) {
  try {
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
