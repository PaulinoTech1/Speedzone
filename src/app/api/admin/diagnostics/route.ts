import { isAdmin, privateResponseHeaders } from "@/lib/admin-auth";
import { diagnosticDefinition, diagnosticOperations, readDiagnostics, withDiagnostics, type DiagnosticOperation } from "@/lib/diagnostics";

export async function GET() {
  return withDiagnostics("ADMIN_DIAGNOSTICS_READ", async () => {
    if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: privateResponseHeaders() });
    const events = await readDiagnostics();
    const catalog = Object.keys(diagnosticOperations).flatMap(operation => [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503].map(status => diagnosticDefinition(operation as DiagnosticOperation, status)));
    return Response.json({ events, catalog }, { headers: privateResponseHeaders() });
  });
}
