import { NextResponse } from "next/server";
import { withDiagnostics } from "@/lib/diagnostics";
import { isAdmin, privateResponseHeaders } from "@/lib/admin-auth";
import { validAdminMutation } from "@/lib/admin-mutation";
import { InventoryReadOnlyError, normalizeEtag, readInventorySnapshot, writeInventory } from "@/lib/inventory";
import { securityRequestContext, writeSecurityEvent } from "@/lib/security-events";
import { readBoundedJson, RequestBodyError } from "../../../../../security-console/shared/mutation-request";
import { CsvError, csvLimits } from "@/lib/integrations/dealercenter/csv";
import { parseMappingOverride } from "@/lib/integrations/dealercenter/mapping";
import { planInventoryImport } from "@/lib/integrations/dealercenter/import";

// JSON envelope overhead on top of the 1 MB CSV limit.
const bodyLimit = csvLimits.maxBytes + 64 * 1024;

/**
 * Admin-only DealerCenter CSV import. `mode: "preview"` returns a diff and a
 * digest; `mode: "apply"` must echo that digest plus the catalog revision
 * (If-Match), so only the exact previewed file is committed.
 * Requires a passkey session (not the password setup session).
 */
async function handlePOST(request: Request) {
  const context = securityRequestContext(request, true);
  const headers = privateResponseHeaders();
  if (!(await isAdmin(request))) {
    await writeSecurityEvent({ ...context, event: "inventory.mutation", outcome: "denied", actor: "anonymous", reason: "authentication_required", metadata: { operation: "import" } });
    return NextResponse.json({ error: "A passkey session is required to import inventory." }, { status: 401, headers });
  }
  if (!validAdminMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers });
  let mode = "preview";
  try {
    const body = await readBoundedJson(request, bodyLimit) as { csv?: unknown; mode?: unknown; fullImport?: unknown; mapping?: unknown; digest?: unknown };
    if (typeof body.csv !== "string" || !body.csv.trim()) return NextResponse.json({ error: "Choose a CSV export to import." }, { status: 400, headers });
    if (body.mode !== "preview" && body.mode !== "apply") return NextResponse.json({ error: "Invalid import mode" }, { status: 400, headers });
    mode = body.mode;
    const fullImport = body.fullImport === true;
    const mapping = parseMappingOverride(body.mapping);
    const { vehicles, revision } = await readInventorySnapshot();
    const { diff, next } = planInventoryImport(body.csv, vehicles, { fullImport, mapping });
    const counts = { added: diff.added.length, updated: diff.updated.length, marked_sold: diff.removed.length, unchanged: diff.unchanged, row_errors: diff.errors.length, blocked_columns: diff.columns.blocked.length, full_import: fullImport };

    if (mode === "preview") {
      await writeSecurityEvent({ ...context, event: "inventory.mutation", outcome: "allowed", actor: "admin", reason: "import_previewed", metadata: { ...counts, catalog_revision: revision } });
      return NextResponse.json({ diff, revision }, { headers });
    }
    if (typeof body.digest !== "string" || body.digest !== diff.digest) return NextResponse.json({ error: "The file or options changed since the preview. Preview again before applying." }, { status: 409, headers });
    if (normalizeEtag(request.headers.get("if-match")) !== revision) {
      await writeSecurityEvent({ ...context, event: "inventory.mutation", outcome: "denied", actor: "admin", reason: "revision_conflict", metadata: { operation: "import", catalog_revision: revision } });
      return NextResponse.json({ error: "Inventory changed since the preview. Preview again before applying." }, { status: 409, headers });
    }
    if (diff.errors.length) return NextResponse.json({ error: "Fix the rows with errors before applying the import." }, { status: 422, headers });
    if (!diff.added.length && !diff.updated.length && !diff.removed.length) return NextResponse.json({ diff, revision, applied: false }, { headers });
    const saved = await writeInventory(next, revision);
    await writeSecurityEvent({ ...context, event: "inventory.mutation", outcome: "allowed", actor: "admin", reason: "import_applied", metadata: { ...counts, catalog_revision_before: revision, catalog_revision_after: saved.etag } });
    return NextResponse.json({ diff, revision: saved.etag, applied: true }, { headers: { ...headers, ETag: saved.etag } });
  } catch (error) {
    const failureClass = error instanceof Error ? (error.constructor?.name || error.name) : "UnknownError";
    await writeSecurityEvent({ ...context, event: "inventory.mutation", outcome: "failed", actor: "admin", reason: `import_${mode}_failed`, metadata: { failure_class: failureClass } });
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof InventoryReadOnlyError) return NextResponse.json({ error: error.message }, { status: 503, headers });
    if (error instanceof CsvError || (error instanceof Error && /column|mapping|no vehicle rows|required/i.test(error.message))) return NextResponse.json({ error: error.message }, { status: 400, headers });
    if (error instanceof Error && /already exists|precondition/i.test(error.message + failureClass)) return NextResponse.json({ error: "Inventory changed. Preview again before applying." }, { status: 409, headers });
    return NextResponse.json({ error: "Unable to import inventory. Check the file and try again." }, { status: 400, headers });
  }
}

export async function POST(request: Request) { return withDiagnostics("INVENTORY_IMPORT", () => handlePOST(request)); }
