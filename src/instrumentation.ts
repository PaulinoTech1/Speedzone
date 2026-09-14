import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async () => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordDiagnostic } = await import("@/lib/diagnostics");
    await recordDiagnostic("SERVER_RENDER_OR_FRAMEWORK_REQUEST", 500);
  }
};
