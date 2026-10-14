const PRODUCTION_HOSTS = ["www.speedzonems.com", "speedzonems.com"];

/**
 * Origin for the internal render request. The Host header is only trusted when
 * it names this site or this deployment, so a forged Host can never point the
 * render (and the cached document) at another server.
 */
export function renderOrigin(hostHeader: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const host = (hostHeader ?? "").toLowerCase().trim();
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) return null;
  const hostname = host.split(":")[0]!;
  if (!env.VERCEL) {
    return hostname === "localhost" || hostname === "127.0.0.1" ? `http://${host}` : null;
  }
  const trusted = new Set([
    ...PRODUCTION_HOSTS,
    ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase()),
  ]);
  return trusted.has(host) ? `https://${host}` : null;
}
