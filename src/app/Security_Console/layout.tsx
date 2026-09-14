import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./security-console.css";

export const metadata: Metadata = {
  title: "Security Console",
  robots: { index: false, follow: false, nocache: true },
};

export default function SecurityConsoleLayout({ children }: { children: ReactNode }) {
  return <div className="embedded-security-console">{children}</div>;
}
