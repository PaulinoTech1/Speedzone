import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/inventory/image/route";

const origin = "https://store-id.public.blob.vercel-storage.com";
const url = `${origin}/inventory/photos/photo.webp`;

function request(value = url) {
  return new NextRequest(`http://localhost/api/inventory/image?url=${encodeURIComponent(value)}`);
}

function pngResponse(body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
  return new Response(body, { headers: { "content-type": "text/html" } });
}

describe("inventory image proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.INVENTORY_BLOB_ORIGIN;
  });

  it("fails closed when the approved origin is not configured", async () => {
    expect((await GET(request())).status).toBe(500);
  });

  it("rejects suffix tricks and paths outside inventory photos", async () => {
    process.env.INVENTORY_BLOB_ORIGIN = origin;
    expect((await GET(request("https://store-id.public.blob.vercel-storage.com.evil.example/inventory/photos/photo.webp"))).status).toBe(403);
    expect((await GET(request(`${origin}/inventory/inventory.json`))).status).toBe(403);
  });

  it("rejects redirects and invalid image bytes", async () => {
    process.env.INVENTORY_BLOB_ORIGIN = origin;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.example" } }));
    expect((await GET(request())).status).toBe(404);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<svg></svg>", { headers: { "content-type": "image/png" } }));
    expect((await GET(request())).status).toBe(415);
  });

  it("returns valid images with hardened headers and detected content type", async () => {
    process.env.INVENTORY_BLOB_ORIGIN = origin;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pngResponse());
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("rejects bodies over the 8 MiB limit", async () => {
    process.env.INVENTORY_BLOB_ORIGIN = origin;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    expect((await GET(request())).status).toBe(413);
  });
});
