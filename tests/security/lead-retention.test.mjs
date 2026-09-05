import { describe, expect, it, vi } from "vitest";
import { runRetention } from "../../scripts/lead-retention.mjs";

const path = "leads/test-drive/12345678-1234-4234-8234-123456789abc.json";
const settings = { days: 90, token: "fixture", storeId: "store_fixture", now: Date.UTC(2026, 8, 5) };
const old = { pathname: path, uploadedAt: new Date("2025-01-01") };

describe("lead retention", () => {
  it("defaults to a dry run and selects only old test-drive records", async () => {
    const api = { list: vi.fn().mockResolvedValue({ hasMore: false, blobs: [old,
      { ...old, pathname: "auth/state.json" },
      { ...old, pathname: "leads/test-drive/customer-name.json" },
      { ...old, uploadedAt: new Date(settings.now) },
    ] }), del: vi.fn() };
    expect(await runRetention(settings, api)).toMatchObject({ mode: "dry-run", records: 1 });
    expect(api.del).not.toHaveBeenCalled();
  });
  it("requires explicit application and processes all pages before deletion", async () => {
    const api = { list: vi.fn().mockResolvedValueOnce({ hasMore: true, cursor: "next", blobs: [old] })
      .mockResolvedValueOnce({ hasMore: false, blobs: [old] }), del: vi.fn() };
    expect(await runRetention({ ...settings, apply: true }, api)).toMatchObject({ mode: "applied", records: 1 });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.del).toHaveBeenCalledExactlyOnceWith([path], { token: "fixture", storeId: "store_fixture" });
  });
  it("refuses deletion on invalid pagination", async () => {
    const api = { list: vi.fn().mockResolvedValue({ hasMore: true, cursor: "same", blobs: [old] }), del: vi.fn() };
    await expect(runRetention({ ...settings, apply: true }, api)).rejects.toThrow("Invalid storage pagination");
    expect(api.del).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, 3651])("refuses invalid retention periods (%s)", async (days) => {
    const api = { list: vi.fn(), del: vi.fn() };
    await expect(runRetention({ ...settings, days, apply: true }, api)).rejects.toThrow("--days");
    expect(api.list).not.toHaveBeenCalled();
    expect(api.del).not.toHaveBeenCalled();
  });
});
