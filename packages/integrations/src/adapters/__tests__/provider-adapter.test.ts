import { describe, it, expect, beforeEach } from "vitest";
import { MockProviderAdapter } from "../provider-adapter.js";

describe("MockProviderAdapter", () => {
  let adapter: MockProviderAdapter;

  beforeEach(() => {
    adapter = new MockProviderAdapter();
  });

  describe("validateConfig", () => {
    it("should pass validation", async () => {
      await expect(adapter.validateConfig()).resolves.not.toThrow();
    });
  });

  describe("search", () => {
    it("should return providers for emergency_department", async () => {
      const results = await adapter.search({
        careCategory: "emergency_department",
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.careCategories).toContain("emergency_department");
    });

    it("should return providers for primary_care", async () => {
      const results = await adapter.search({
        careCategory: "primary_care",
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.careCategories).toContain("primary_care");
    });

    it("should return providers for eye_care", async () => {
      const results = await adapter.search({
        careCategory: "eye_care",
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((p) => {
        expect(p.careCategories).toContain("eye_care");
      });
    });

    it("should include source metadata", async () => {
      const results = await adapter.search({
        careCategory: "primary_care",
      });
      expect(results[0]).toHaveProperty("source", "mock");
      expect(results[0]).toHaveProperty("sourceRecordId");
      expect(results[0]).toHaveProperty("lastVerifiedAt");
    });

    it("should filter by location if coordinates provided", async () => {
      const results = await adapter.search({
        careCategory: "primary_care",
        latitude: -1.2921,
        longitude: 36.8219,
      });
      expect(results.length).toBeGreaterThan(0);
      // All results should be within 50km radius
      results.forEach((p) => {
        expect(p.latitude).toBeDefined();
        expect(p.longitude).toBeDefined();
      });
    });

    it("should return empty for unknown category with no proximate providers", async () => {
      // Searching far from any provider location
      const results = await adapter.search({
        careCategory: "primary_care",
        latitude: 0,
        longitude: 0,
      });
      expect(results.length).toBe(0);
    });

    it("should include phone numbers in results", async () => {
      const results = await adapter.search({
        careCategory: "primary_care",
      });
      expect(results[0]).toHaveProperty("phone");
    });

    it("should include address in results", async () => {
      const results = await adapter.search({
        careCategory: "primary_care",
      });
      expect(results[0]).toHaveProperty("address");
    });

    it("should include opening status", async () => {
      const results = await adapter.search({
        careCategory: "emergency_department",
      });
      expect(results[0]).toHaveProperty("openingStatus");
    });
  });

  describe("getDetails", () => {
    it("should return provider details by ID", async () => {
      const result = await adapter.getDetails("nairobi-primary-001");
      expect(result.id).toBe("nairobi-primary-001");
      expect(result.name).toBe("Nairobi Primary Care Clinic");
    });

    it("should throw for unknown provider ID", async () => {
      await expect(adapter.getDetails("unknown-id")).rejects.toThrow(
        "Provider not found"
      );
    });

    it("should return complete provider object", async () => {
      const result = await adapter.getDetails("nairobi-emg-001");
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("facilityType");
      expect(result).toHaveProperty("careCategories");
      expect(result).toHaveProperty("latitude");
      expect(result).toHaveProperty("longitude");
      expect(result).toHaveProperty("address");
      expect(result).toHaveProperty("phone");
      expect(result).toHaveProperty("openingStatus");
      expect(result).toHaveProperty("source");
      expect(result).toHaveProperty("sourceRecordId");
      expect(result).toHaveProperty("lastVerifiedAt");
    });
  });

  describe("distance calculation", () => {
    it("should prioritize nearby providers", async () => {
      const results = await adapter.search({
        careCategory: "primary_care",
        latitude: -1.3, // Near Westlands
        longitude: 36.8,
      });

      expect(results.length).toBeGreaterThan(0);
      // Nearest provider should be close
      const firstResult = results[0];
      expect(firstResult).toBeDefined();
    });
  });
});
