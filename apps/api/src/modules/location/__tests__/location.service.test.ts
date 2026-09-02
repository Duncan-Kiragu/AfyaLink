import { describe, it, expect, beforeEach } from "vitest";
import { LocationService } from "../location.service.js";
import { EphemeralLocationStore } from "../ephemeral-location.store.js";
import { GeocodingAdapterImpl } from "@kkd/integrations";

describe("LocationService", () => {
  let store: EphemeralLocationStore;
  let service: LocationService;

  beforeEach(() => {
    store = new EphemeralLocationStore();
    service = new LocationService(new GeocodingAdapterImpl(), store);
  });

  describe("resolveLocation", () => {
    it("should resolve a manual location", async () => {
      const result = await service.resolveLocation({
        method: "manual",
        areaQuery: "Nairobi",
      });
      expect(result).toHaveProperty("latitude");
      expect(result).toHaveProperty("longitude");
      expect(result).toHaveProperty("timestamp");
    });

    it("should resolve browser coordinates supplied by the client", async () => {
      const result = await service.resolveLocation({
        method: "browser",
        latitude: -1.2921,
        longitude: 36.8219,
        urgency: "emergency",
      });
      expect(result.latitude).toBe(-1.2921);
      expect(result.method).toBe("browser");
    });

    it("should accept coordinates at the origin", async () => {
      // Regression: 0 is a valid coordinate and must not be treated as missing.
      const result = await service.resolveLocation({
        method: "browser",
        latitude: 0,
        longitude: 0,
        urgency: "emergency",
      });
      expect(result.latitude).toBe(0);
      expect(result.longitude).toBe(0);
    });

    it("should reject browser method without coordinates", async () => {
      await expect(service.resolveLocation({ method: "browser" })).rejects.toThrow();
    });

    it("should throw for unknown manual location", async () => {
      await expect(
        service.resolveLocation({ method: "manual", areaQuery: "Unknown Place" })
      ).rejects.toThrow();
    });

    it("should require area query for manual method", async () => {
      await expect(service.resolveLocation({ method: "manual" })).rejects.toThrow();
    });

    it("should reject invalid method", async () => {
      await expect(
        service.resolveLocation({ method: "invalid" as never })
      ).rejects.toThrow();
    });
  });

  describe("precision reduction (spec 9.5.A.4)", () => {
    it("should keep exact precision for emergency searches", async () => {
      const result = await service.resolveLocation({
        method: "browser",
        latitude: -1.29213456,
        longitude: 36.82197654,
        urgency: "emergency",
      });
      expect(result.precision).toBe("exact");
      expect(result.latitude).toBe(-1.29213456);
    });

    it("should reduce precision for non-emergency searches", async () => {
      const result = await service.resolveLocation({
        method: "browser",
        latitude: -1.29213456,
        longitude: 36.82197654,
        urgency: "soon",
      });
      expect(result.precision).toBe("reduced");
      expect(result.latitude).toBe(-1.29);
      expect(result.longitude).toBe(36.82);
    });

    it("should reduce precision when urgency is unknown", async () => {
      const result = await service.resolveLocation({
        method: "browser",
        latitude: -1.29213456,
        longitude: 36.82197654,
      });
      expect(result.precision).toBe("reduced");
    });
  });

  describe("ephemeral session location (spec 9.3 / 9.5.A.5)", () => {
    it("should store location against a session", async () => {
      await service.resolveLocation({
        method: "manual",
        areaQuery: "Nairobi",
        sessionId: "session-1",
      });
      expect(service.getSessionLocation("session-1")).not.toBeNull();
    });

    it("should not store anything without a session id", async () => {
      await service.resolveLocation({ method: "manual", areaQuery: "Nairobi" });
      expect(store.size).toBe(0);
    });

    it("should leave no coordinates after the session is cleared", async () => {
      await service.resolveLocation({
        method: "manual",
        areaQuery: "Nairobi",
        sessionId: "session-2",
      });

      service.clearSessionLocation("session-2");

      expect(service.getSessionLocation("session-2")).toBeNull();
      expect(store.size).toBe(0);
    });

    it("should treat clearing an unknown session as a no-op", () => {
      expect(() => service.clearSessionLocation("never-existed")).not.toThrow();
    });
  });

  describe("validateCoordinates", () => {
    it("should validate correct coordinates", () => {
      expect(
        service.validateCoordinates({
          latitude: -1.2921,
          longitude: 36.8219,
          timestamp: new Date().toISOString(),
        })
      ).toBe(true);
    });

    it("should reject invalid latitude", () => {
      expect(
        service.validateCoordinates({
          latitude: 91,
          longitude: 36.8219,
          timestamp: new Date().toISOString(),
        })
      ).toBe(false);
    });

    it("should reject missing timestamp", () => {
      expect(
        service.validateCoordinates({
          latitude: -1.2921,
          longitude: 36.8219,
        } as never)
      ).toBe(false);
    });
  });
});
