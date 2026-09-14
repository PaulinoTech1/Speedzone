import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ list: mocks.list, get: mocks.get }));
vi.mock("@/lib/admin-auth", () => ({
  isAdmin: mocks.isAdmin,
  privateResponseHeaders: () => ({ "Cache-Control": "private, no-store, max-age=0" }),
}));
vi.mock("@/lib/test-drive-crypto", () => ({ decryptTestDrivePayload: mocks.decrypt }));

import { GET } from "@/app/api/admin/test-drives/route";

const request = () => new Request("https://speedzone.example/api/admin/test-drives");

describe("admin test-drive inbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEST_DRIVE_BLOB_READ_WRITE_TOKEN", "synthetic-private-token");
    mocks.isAdmin.mockResolvedValue(true);
    mocks.get.mockImplementation(async (pathname: string) => pathname === "missing"
      ? null
      : { stream: new Response(pathname).body });
    mocks.decrypt.mockImplementation(async (value: string) => {
      if (value === "corrupt") throw new Error("Unreadable fixture");
      return { id: value, createdAt: value === "newer" ? "2026-09-12T12:00:00Z" : "2026-09-11T12:00:00Z" };
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps available records sorted when a listed blob disappears", async () => {
    mocks.list.mockResolvedValue({ blobs: ["older", "missing", "corrupt", "newer"].map(pathname => ({ pathname })) });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual([
      { id: "newer", pathname: "newer", createdAt: "2026-09-12T12:00:00Z" },
      { id: "older", pathname: "older", createdAt: "2026-09-11T12:00:00Z" },
      { pathname: "corrupt", unreadable: true },
    ]);
  });

  it("returns an empty array when all listed records disappear", async () => {
    mocks.list.mockResolvedValue({ blobs: [{ pathname: "missing" }] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("does not read private storage without authorization", async () => {
    mocks.isAdmin.mockResolvedValue(false);

    expect((await GET(request())).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("keeps the not-found response for an individual missing record", async () => {
    const response = await GET(new Request(`${request().url}?pathname=missing`));

    expect(response.status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("makes all 250 records reachable through bounded cursor pages", async () => {
    mocks.list.mockImplementation(async ({ cursor, limit }) => {
      const offset = Number(cursor || 0);
      return { blobs: Array.from({ length: Math.min(limit, 250 - offset) }, (_, i) => ({ pathname: String(offset + i) })), hasMore: offset + limit < 250, cursor: String(offset + limit) };
    });
    const paths: string[] = []; let cursor = "";
    do {
      const response = await GET(new Request(request().url + (cursor ? "?cursor=" + cursor : "")));
      expect(response.status).toBe(200);
      const page = await response.json(); expect(page.length).toBeLessThanOrEqual(20);
      paths.push(...page.map((item: { pathname: string }) => item.pathname));
      cursor = response.headers.get("x-next-cursor") || "";
    } while (cursor);
    expect(paths).toHaveLength(250); expect(new Set(paths).size).toBe(250);
  });
});
