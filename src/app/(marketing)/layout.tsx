import type { ReactNode } from "react";
import MarketingConsent from "@/components/public/MarketingConsent";

// Public pages only; admin and security-console routes never render the consent manager or Pixel.
export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}<MarketingConsent /></>;
}
