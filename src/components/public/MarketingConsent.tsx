import { metaPixelConfig } from "@/lib/meta-pixel-config";
import ConsentManager from "@/components/public/ConsentManager";

/** Server gate: with the flag off nothing is rendered and no Pixel ID reaches the browser. */
export default function MarketingConsent() {
  const config = metaPixelConfig();
  return config ? <ConsentManager pixelId={config.pixelId} /> : null;
}
