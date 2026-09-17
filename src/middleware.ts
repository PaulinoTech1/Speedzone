import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The admin portals live on dedicated subdomains. Rewrite portal-bound hosts
// to their app routes. Real routes (API, Next.js internals, static files) and
// paths already under the portal prefix are served untouched on every host.
const PORTALS: Array<{ hosts: string[]; prefix: string }> = [
  {
    hosts: [
      "admin-inventory.speedzonems.com",
      "www.admin-inventory.speedzonems.com",
    ],
    prefix: "/admin",
  },
  {
    hosts: [
      "security-console.speedzonems.com",
      "www.security-console.speedzonems.com",
    ],
    prefix: "/Security_Console",
  },
];

export function middleware(request: NextRequest) {
  const host = ((request.headers.get("host") ?? "").toLowerCase().split(":")[0] ?? "");
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  for (const portal of PORTALS) {
    if (portal.hosts.includes(host) && !pathname.startsWith(portal.prefix)) {
      const url = request.nextUrl.clone();
      url.pathname = `${portal.prefix}${pathname}`;
      return NextResponse.rewrite(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
