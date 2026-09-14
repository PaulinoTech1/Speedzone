import type { ReactNode } from "react";
import "./globals.css";
export const metadata = { title: "Security Console", description: "Read-only SpeedZone security event console" };
export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body className="security-console">{children}</body></html>; }
