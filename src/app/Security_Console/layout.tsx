import type { ReactNode } from "react";
import "../../../security-console/app/globals.css";

export const metadata = {
  title: "Security Console",
  robots: { index: false, follow: false },
};

export default function SecurityConsoleLayout({ children }: { children: ReactNode }) {
  return <div className="security-console">{children}</div>;
}
