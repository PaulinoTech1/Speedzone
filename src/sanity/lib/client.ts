import { createClient } from "@sanity/client";

/**
 * Token-free Sanity base client configuration.
 *
 * The project ID and dataset name are public identifiers. Never add
 * SANITY_API_TOKEN or SANITY_API_WRITE_TOKEN here: this module is safe to
 * import from browser code. Because SpeedZone's dataset is private, actual
 * inventory reads and all privileged work remain behind the server-only API.
 */
export const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-01-01",
  useCdn: process.env.NODE_ENV === "production",
});
