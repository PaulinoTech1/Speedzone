import type { ReactNode } from "react";
import { connection } from "next/server";
import "./globals.css";
export const metadata = { title: "Security Console", description: "Read-only SpeedZone security event console" };
// Per-request render so Next attaches the proxy's CSP nonce to its scripts.
export default async function Layout({ children }: { children: ReactNode }) { await connection(); return <html lang="en"><body className="security-console">{children}</body></html>; }
