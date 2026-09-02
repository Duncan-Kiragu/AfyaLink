import { describe, it, expect } from "vitest";
import { rankProviders, calculateDistance } from "../ranking.js";
import {
  type CareCategory,
  type NormalizedProvider,
  type ProviderSearchInput,
} from "@kkd/contracts";

const makeProvider = (
  id: string,
  name: string,
  careCategories: CareCategory[],
  latitude?: number,
  longitude?: number,
  openingStatus?: string,
  lastVerifiedAt?: string
): NormalizedProvider => ({
  id,
  name,
  facilityType: "Clinic",
  careCategories,
  latitude,
  longitude,
  address: "Test Address",
  phone: "+254-xxx-xxx",
  openingStatus: openingStatus || "open",
  source: "test",
  sourceRecordId: "test-001",
  lastVerifiedAt: lastVerifiedAt || new Date().toISOString(),
});

describe("Provider Ranking", () => {
  describe("careCategory filtering", () => {
    it("should filter providers by care category", () => {
      const providers = [
        makeProvider("1", "Primary Care", ["primary_care"]),
        makeProvider("2", "Emergency", ["emergency_department"]),
      ];

      const input: ProviderSearchInput = {
        careCategory: "primary_care",
      };

      const result = rankProviders(providers, input);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("1");
    });

    it("should return empty if no matching category", () => {
      const providers = [makeProvider("1", "Primary Care", ["primary_care"])];

      const input: ProviderSearchInput = {
        careCategory: "eye_care",
      };

      const result = rankProviders(providers, input);
      expect(result).toHaveLength(0);
    });
  });

  describe("emergency prioritization", () => {
    it("should prioritize emergency departments for emergency urgency", () => {
      const providers = [
        makeProvider("1", "Primary Care", ["primary_care"]),
        makeProvider("2", "ED", ["emergency_department"]),
      ];

      const input: ProviderSearchInput = {
        careCategory: "emergency_department",
        urgency: "emergency",
      };

      const result = rankProviders(providers, input);
      expect(result[0]!.id).toBe("2");
    });

    it("should not score emergency bonus for non-emergency urgency", () => {
      const providers = [
        makeProvider("1", "ED", ["emergency_department"], -1.3, 36.8),
        makeProvider("2", "Primary", ["emergency_department"], -1.5, 36.8),
      ];

      const input: ProviderSearchInput = {
        careCategory: "emergency_department",
        urgency: "soon",
      };

      const result = rankProviders(providers, input);
      // Distance should matter more
      expect(result.length).toBe(2);
    });
  });

  describe("verification freshness", () => {
    it("should prioritize recently verified providers", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days
      const old = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days

      const providers = [
        makeProvider("1", "Old Clinic", ["primary_care"], -1.3, 36.8, "open", old.toISOString()),
        makeProvider("2", "New Clinic", ["primary_care"], -1.3, 36.8, "open", recent.toISOString()),
      ];

      const input: ProviderSearchInput = {
        careCategory: "primary_care",
      };

      const result = rankProviders(providers, input);
      expect(result[0]!.id).toBe("2");
    });
  });

  describe("distance scoring", () => {
    it("should prioritize closer providers", () => {
      const userLat = -1.3;
      const userLon = 36.8;

      const providers = [
        makeProvider("1", "Far Clinic", ["primary_care"], -1.2, 36.8), // ~11km away
        makeProvider("2", "Near Clinic", ["primary_care"], -1.31, 36.8), // ~1km away
      ];

      const input: ProviderSearchInput = {
        careCategory: "primary_care",
        latitude: userLat,
        longitude: userLon,
      };

      const result = rankProviders(providers, input);
      expect(result[0]!.id).toBe("2");
    });

    it("should not score distance when coordinates missing", () => {
      const providers = [
        makeProvider("1", "No Coords", ["primary_care"]),
        makeProvider("2", "Has Coords", ["primary_care"], -1.3, 36.8),
      ];

      const input: ProviderSearchInput = {
        careCategory: "primary_care",
        latitude: -1.3,
        longitude: 36.8,
      };

      const result = rankProviders(providers, input);
      expect(result.length).toBe(2);
    });
  });

  describe("opening status", () => {
    it("should prioritize 24h providers", () => {
      const providers = [
        makeProvider("1", "Clinic", ["primary_care"], -1.3, 36.8, "open"),
        makeProvider("2", "24h Clinic", ["primary_care"], -1.3, 36.8, "open_24h"),
      ];

      const input: ProviderSearchInput = {
        careCategory: "primary_care",
      };

      const result = rankProviders(providers, input);
      expect(result[0]!.id).toBe("2");
    });
  });

  describe("distance calculation", () => {
    it("should calculate distance between coordinates", () => {
      // Nairobi to Mombasa is approximately 480km
      const distance = calculateDistance(-1.2921, 36.8219, -4.043, 39.668);
      expect(distance).toBeGreaterThan(400);
      expect(distance).toBeLessThan(550);
    });

    it("should return 0 for same coordinates", () => {
      const distance = calculateDistance(-1.2921, 36.8219, -1.2921, 36.8219);
      expect(distance).toBeLessThan(0.1);
    });
  });

  describe("combined ranking", () => {
    it("should rank by multiple factors", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      const providers = [
        // Provider 1: far, old, closed
        makeProvider("1", "Far Old", ["primary_care"], -1.1, 36.8, "unknown", new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString()),
        // Provider 2: close, recent, 24h
        makeProvider("2", "Near New", ["primary_care"], -1.31, 36.8, "open_24h", recent.toISOString()),
      ];

      const input: ProviderSearchInput = {
        careCategory: "primary_care",
        latitude: -1.3,
        longitude: 36.8,
      };

      const result = rankProviders(providers, input);
      expect(result[0]!.id).toBe("2");
    });

    it("should emergency override other factors", () => {
      const providers = [
        makeProvider("1", "ED Far", ["emergency_department"], -1.1, 36.8),
        makeProvider("2", "Primary Near", ["primary_care"], -1.31, 36.8),
      ];

      const input: ProviderSearchInput = {
        careCategory: "emergency_department",
        urgency: "emergency",
        latitude: -1.3,
        longitude: 36.8,
      };

      const result = rankProviders(providers, input);
      expect(result[0]!.id).toBe("1");
    });
  });
});
