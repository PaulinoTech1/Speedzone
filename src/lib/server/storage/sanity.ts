import "server-only";

import { ClientError, createClient, type SanityClient } from "@sanity/client";

import { sanityConfig } from "@/lib/server/env";
import { StateConfigurationError, StateConflictError } from "@/lib/server/storage/errors";

type CachedClient = { key: string; client: SanityClient };
const clientGlobal = globalThis as typeof globalThis & {
  __speedzoneSanityClient?: CachedClient;
};

/**
 * A malformed configuration is an operator problem, not a runtime fault, so it
 * fails closed the same way a missing one does.
 */
function settings() {
  try {
    return sanityConfig();
  } catch (error) {
    throw new StateConfigurationError(
      error instanceof Error ? error.message : "Inventory storage is not configured",
    );
  }
}

/** True when this deployment has Sanity project/dataset/token configured. */
export function sanityConfigured(): boolean {
  return Boolean(settings());
}

/**
 * Vehicle inventory is authoritative in Sanity. One client is reused per
 * project+dataset pair; a rotated token takes effect without a rebuild since
 * the token only affects the headers each request sends, not the client shape.
 *
 * `useCdn: false` mirrors the Blob reads this replaced (`useCache: false`):
 * every read must be strongly consistent, since `unstable_cache`/`revalidateTag`
 * in `public-inventory.ts` is the caching layer, not Sanity's CDN. `perspective:
 * "raw"` is defense-in-depth against draft shadow documents — this app never
 * writes one, but a human clicking around Sanity's own dashboard could.
 */
export function sanity(): SanityClient {
  const target = settings();
  if (!target) {
    throw new StateConfigurationError("Inventory storage (Sanity) is not configured");
  }
  const key = `${target.projectId}:${target.dataset}:${target.token}`;
  const cached = clientGlobal.__speedzoneSanityClient;
  if (cached?.key === key) return cached.client;
  const client = createClient({
    projectId: target.projectId,
    dataset: target.dataset,
    token: target.token,
    apiVersion: target.apiVersion,
    useCdn: false,
    perspective: "raw",
  });
  clientGlobal.__speedzoneSanityClient = { key, client };
  return client;
}

export function isConflict(error: unknown): boolean {
  return error instanceof ClientError && error.statusCode === 409;
}

/**
 * Distinguish an operator-fixable misconfiguration, which fails closed as a
 * 503, from a transient failure or a real business-rule rejection, which must
 * keep surfacing as-is. A 409 is never translated here: callers resolve a
 * conflict themselves by re-reading the document, since only they know whether
 * it was a revision race or a uniqueness-lock collision.
 */
export function translateSanityError(error: unknown): unknown {
  if (error instanceof StateConfigurationError || error instanceof StateConflictError) return error;
  if (!(error instanceof ClientError)) return error;
  if (error.statusCode === 401 || error.statusCode === 403) {
    return new StateConfigurationError("Inventory storage credentials are not usable");
  }
  if (error.statusCode === 404) {
    return new StateConfigurationError("Inventory dataset was not found");
  }
  return error;
}
