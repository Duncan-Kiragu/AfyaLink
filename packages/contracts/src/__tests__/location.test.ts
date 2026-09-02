import { describe, it, expect } from "vitest";
import {
  coordinatesSchema,
  locationInputSchema,
  locationConsentSchema,
  locationSearchRequestSchema,
  locationSearchResponseSchema,
} from "../location.js";

describe("Location Contracts", () => {
  describe("coordinatesSchema", () => {
    it("should validate valid coordinates", () => {
      const data = {
        latitude: -1.2921,
        longitude: 36.8219,
        accuracy: 10,
        timestamp: new Date().toISOString(),
      };
      expect(() => coordinatesSchema.parse(data)).not.toThrow();
    });

    it("should reject invalid latitude", () => {
      expect(() =>
        coordinatesSchema.parse({
          latitude: 91,
          longitude: 36.8219,
          timestamp: new Date().toISOString(),
        })
      ).toThrow();
    });

    it("should reject invalid longitude", () => {
      expect(() =>
        coordinatesSchema.parse({
          latitude: -1.2921,
          longitude: 181,
          timestamp: new Date().toISOString(),
        })
      ).toThrow();
    });
  });

  describe("locationInputSchema", () => {
    it("should validate browser location input", () => {
      const data = { method: "browser", latitude: -1.2921, longitude: 36.8219 };
      expect(() => locationInputSchema.parse(data)).not.toThrow();
    });

    it("should validate manual location input", () => {
      const data = { method: "manual", areaQuery: "Nairobi" };
      expect(() => locationInputSchema.parse(data)).not.toThrow();
    });

    it("should reject invalid method", () => {
      expect(() =>
        locationInputSchema.parse({ method: "invalid" })
      ).toThrow();
    });
  });

  describe("locationConsentSchema", () => {
    it("should validate location consent", () => {
      const data = {
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        method: "browser",
        permissionGranted: true,
        consentVersion: "1.0",
        recordedAt: new Date().toISOString(),
      };
      expect(() => locationConsentSchema.parse(data)).not.toThrow();
    });
  });

  describe("locationSearchRequestSchema", () => {
    it("should validate browser location request", () => {
      const data = {
        method: "browser",
        latitude: -1.2921,
        longitude: 36.8219,
      };
      expect(() => locationSearchRequestSchema.parse(data)).not.toThrow();
    });

    it("should validate manual location request", () => {
      const data = { method: "manual", areaQuery: "Nairobi" };
      expect(() => locationSearchRequestSchema.parse(data)).not.toThrow();
    });
  });

  describe("locationSearchResponseSchema", () => {
    it("should validate location response", () => {
      const data = {
        latitude: -1.2921,
        longitude: 36.8219,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        method: "browser",
      };
      expect(() => locationSearchResponseSchema.parse(data)).not.toThrow();
    });
  });
});
