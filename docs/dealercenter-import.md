# DealerCenter inventory import

Admin → **Import from DealerCenter**. This needs a passkey session; password/setup sessions are refused.

1. Upload a CSV or tab-delimited export (max 1 MB, 600 rows).
2. **Preview** shows new, updated and marked-sold vehicles, row errors, the column mapping it used, and any discarded columns. Nothing is saved at this step.
3. **Apply** commits exactly the previewed file. The request must send the preview's digest plus the catalog revision (If-Match). Any rows with errors block the apply.

Rules:
- Vehicles are matched by VIN, falling back to stock number.
- DealerCenter owns the core fields and listing details. The site keeps the listing id/URL, photos, creation time and condition, and keeps its own description when the export has none.
- "Complete inventory" mode marks vehicles that are missing from the file as **sold**; it never deletes them. Manual listings with no VIN or stock number are never touched.
- Customer, contact, address, cost, deal and notes columns are discarded before any of their values are read, and they cannot be mapped. Only their header names are reported.
- Photo URLs in the export are counted but not imported. Site photos must live in the inventory Blob store; a later phase will download and validate them.

The default column aliases are in `src/lib/integrations/dealercenter/mapping.ts` and are **to be confirmed** against a real export. The importer is a pure function (`planInventoryImport`), so a scheduled pull can reuse it. See the PR description for that design.
