import { validMutationOrigin } from "@/lib/shared/mutation-request";

export function validAdminMutation(request: Request) {
  const origin = process.env.WEBAUTHN_ORIGIN?.trim();
  if (process.env.VERCEL_ENV === "production" && !origin) return false;
  return validMutationOrigin(request, [origin || new URL(request.url).origin]);
}
