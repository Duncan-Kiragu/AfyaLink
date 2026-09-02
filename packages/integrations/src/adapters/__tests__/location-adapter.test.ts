import { describe, it, expect, beforeEach } from "vitest";
import { GeocodingAdapterImpl } from "../location-adapter.js";

describe("GeocodingAdapter", () => {
  let adapter: GeocodingAdapterImpl;

  beforeEach(() => {
    adapter = new GeocodingAdapterImpl();
  });

  describe("geocodeManualLocation", () => {
    it("should return Nairobi coordinates", async () => {
      const results = await adapter.geocodeManualLocation("Nairobi");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        latitude: -1.2921,
        longitude: 36.8219,
      });
    });

    it("should return Mombasa coordinates", async () => {
      const results = await adapter.geocodeManualLocation("Mombasa");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        latitude: -4.043,
        longitude: 39.668,
      });
    });

    it("should be case-insensitive", async () => {
      const [a] = await adapter.geocodeManualLocation("NAIROBI");
      const [b] = await adapter.geocodeManualLocation("nairobi");
      expect(a!.latitude).toBe(b!.latitude);
      expect(a!.longitude).toBe(b!.longitude);
    });

    it("should trim whitespace", async () => {
      const results = await adapter.geocodeManualLocation("  Nairobi  ");
      expect(results).toHaveLength(1);
    });

    it("should resolve an area within a known city", async () => {
      const results = await adapter.geocodeManualLocation("Westlands, Nairobi");
      expect(results[0]).toMatchObject({ latitude: -1.2921 });
    });

    it("should throw for unknown location", async () => {
      await expect(adapter.geocodeManualLocation("Unknown City")).rejects.toThrow();
    });

    it("should include accuracy metadata", async () => {
      const results = await adapter.geocodeManualLocation("Nairobi");
      expect(results[0]!.accuracy).toBe(5000);
    });

    it("should include ISO timestamp", async () => {
      const results = await adapter.geocodeManualLocation("Nairobi");
      expect(results[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it("does not depend on browser globals", () => {
    // Regression: this package runs in the API and worker, where `navigator`
    // is undefined. Constructing the adapter must not touch it.
    expect(() => new GeocodingAdapterImpl()).not.toThrow();
    expect("getBrowserLocation" in adapter).toBe(false);
  });
});
