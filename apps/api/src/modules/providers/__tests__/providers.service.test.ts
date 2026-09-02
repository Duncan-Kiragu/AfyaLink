import { describe, it, expect, beforeEach } from "vitest";
import { ProvidersService } from "../providers.service.js";
import { MockProviderAdapter } from "@kkd/integrations";

describe("ProvidersService", () => {
  let service: ProvidersService;

  beforeEach(() => {
    service = new ProvidersService();
  });

  describe("searchProviders", () => {
    it("should return providers for primary_care", async () => {
      const { providers } = await service.searchProviders({
        careCategory: "primary_care",
      });
      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((p) => {
        expect(p.careCategories).toContain("primary_care");
      });
    });

    it("should return providers for emergency_department", async () => {
      const { providers } = await service.searchProviders({
        careCategory: "emergency_department",
      });
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should return at least three providers where coverage exists", async () => {
      // Spec 9.7 acceptance criterion.
      const { providers } = await service.searchProviders({
        careCategory: "primary_care",
      });
      expect(providers.length).toBeGreaterThanOrEqual(3);
    });

    it("should filter and rank by coordinates", async () => {
      const { providers } = await service.searchProviders({
        careCategory: "primary_care",
        latitude: -1.3,
        longitude: 36.8,
      });
      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((p) => {
        expect(p.latitude).toBeDefined();
        expect(p.longitude).toBeDefined();
      });
    });

    it("should handle urgency parameter", async () => {
      const { providers } = await service.searchProviders({
        careCategory: "emergency_department",
        urgency: "emergency",
      });
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should return empty for unmatched category", async () => {
      const { providers, degraded } = await service.searchProviders({
        careCategory: "telemedicine",
      });
      expect(providers.length).toBe(0);
      // No providers is not the same as a failed lookup.
      expect(degraded).toBe(false);
    });

    it("should carry source and freshness metadata on every result", async () => {
      // Spec 9.7 - results carry source/freshness metadata internally.
      const { providers } = await service.searchProviders({
        careCategory: "primary_care",
      });
      providers.forEach((p) => {
        expect(p.source).toBeTruthy();
        expect(p.sourceRecordId).toBeTruthy();
        expect(Number.isNaN(Date.parse(p.lastVerifiedAt))).toBe(false);
      });
    });

    it("should degrade gracefully when the adapter fails", async () => {
      // Spec 9.6 - provider adapter failures degrade gracefully.
      const failing = new MockProviderAdapter();
      failing.search = () => Promise.reject(new Error("upstream down"));

      const degradedService = new ProvidersService(failing);
      const result = await degradedService.searchProviders({
        careCategory: "primary_care",
      });

      expect(result.providers).toEqual([]);
      expect(result.degraded).toBe(true);
    });
  });

  describe("getProviderDetails", () => {
    it("should return provider by ID", async () => {
      const provider = await service.getProviderDetails("nairobi-primary-001");
      expect(provider.id).toBe("nairobi-primary-001");
      expect(provider.name).toBeDefined();
    });

    it("should throw for unknown provider", async () => {
      await expect(service.getProviderDetails("unknown-id")).rejects.toThrow();
    });
  });
});
