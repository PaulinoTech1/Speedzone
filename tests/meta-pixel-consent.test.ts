import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metaPixelConfig, parseConsent, shouldLoadPixel } from "@/lib/meta-pixel-config";
import { proxy } from "@/proxy";

const connectSrc = (url: string, host?: string) => proxy(new NextRequest(url, host ? { headers: { host } } : undefined)).headers.get("Content-Security-Policy")!.split("; ").find(d => d.startsWith("connect-src "))!;

describe("Meta Pixel feature flag", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is off unless the flag is exactly 'enabled' and a numeric ID is set", () => {
    expect(metaPixelConfig({})).toBeNull();
    expect(metaPixelConfig({ META_PIXEL_ENABLED: "true", META_PIXEL_ID: "1234567890" })).toBeNull();
    expect(metaPixelConfig({ META_PIXEL_ENABLED: "enabled" })).toBeNull();
    expect(metaPixelConfig({ META_PIXEL_ENABLED: "enabled", META_PIXEL_ID: "abc<script>" })).toBeNull();
    expect(metaPixelConfig({ META_PIXEL_ENABLED: "enabled", META_PIXEL_ID: "1234567890" })).toEqual({ pixelId: "1234567890" });
  });
  it("loads only with flag on AND explicit consent", () => {
    const config = { pixelId: "1234567890" };
    expect(shouldLoadPixel(null, "granted")).toBe(false);
    expect(shouldLoadPixel(config, null)).toBe(false);
    expect(shouldLoadPixel(config, "denied")).toBe(false);
    expect(shouldLoadPixel(config, parseConsent("yes"))).toBe(false);
    expect(shouldLoadPixel(config, parseConsent("granted"))).toBe(true);
  });
  it("adds Meta connect-src only when enabled and never on admin portals", () => {
    expect(connectSrc("https://www.speedzonems.com/")).not.toContain("facebook");
    vi.stubEnv("META_PIXEL_ENABLED", "enabled"); vi.stubEnv("META_PIXEL_ID", "1234567890");
    expect(connectSrc("https://www.speedzonems.com/")).toContain("https://www.facebook.com");
    expect(connectSrc("https://admin-inventory.speedzonems.com/", "admin-inventory.speedzonems.com")).not.toContain("facebook");
    const script = proxy(new NextRequest("https://www.speedzonems.com/")).headers.get("Content-Security-Policy")!.split("; ").find(d => d.startsWith("script-src "))!;
    expect(script).not.toContain("facebook");
  });
});
