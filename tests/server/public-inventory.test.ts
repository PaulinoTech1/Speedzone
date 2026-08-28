import { afterEach, describe, expect, it, vi } from "vitest";

const inventory = vi.hoisted(() => ({
  listPublishedVehicles: vi.fn(),
  findPublishedVehicleBySlug: vi.fn(),
}));

vi.mock("@/lib/server/inventory", () => inventory);

import {
  findPublishedVehicleBySlugOrNull,
  listPublishedVehiclesOrEmpty,
} from "@/lib/server/public-inventory";
import { StateConfigurationError } from "@/lib/server/storage/state";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listPublishedVehiclesOrEmpty", () => {
  it("returns the underlying vehicles on success", async () => {
    const vehicles = [{ id: "vehicle-1" }];
    inventory.listPublishedVehicles.mockResolvedValueOnce(vehicles);
    await expect(listPublishedVehiclesOrEmpty()).resolves.toBe(vehicles);
  });

  it("degrades to an empty list when storage is not configured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    inventory.listPublishedVehicles.mockRejectedValueOnce(
      new StateConfigurationError("Private Blob storage is not configured"),
    );
    await expect(listPublishedVehiclesOrEmpty()).resolves.toEqual([]);
    error.mockRestore();
  });

  it("still propagates unexpected errors", async () => {
    inventory.listPublishedVehicles.mockRejectedValueOnce(new Error("boom"));
    await expect(listPublishedVehiclesOrEmpty()).rejects.toThrow("boom");
  });
});

describe("findPublishedVehicleBySlugOrNull", () => {
  it("returns the underlying vehicle on success", async () => {
    const vehicle = { id: "vehicle-1", slug: "test" };
    inventory.findPublishedVehicleBySlug.mockResolvedValueOnce(vehicle);
    await expect(findPublishedVehicleBySlugOrNull("test")).resolves.toBe(vehicle);
  });

  it("degrades to null when storage is not configured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    inventory.findPublishedVehicleBySlug.mockRejectedValueOnce(
      new StateConfigurationError("Private Blob storage is not configured"),
    );
    await expect(findPublishedVehicleBySlugOrNull("test")).resolves.toBeNull();
    error.mockRestore();
  });

  it("still propagates unexpected errors", async () => {
    inventory.findPublishedVehicleBySlug.mockRejectedValueOnce(new Error("boom"));
    await expect(findPublishedVehicleBySlugOrNull("test")).rejects.toThrow("boom");
  });
});
