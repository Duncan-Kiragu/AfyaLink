import { describe, it, expect } from "vitest";
import { reduceCoordinatePrecision, REDUCED_PRECISION_DECIMALS } from "../precision.js";
import { calculateDistance } from "../ranking.js";

describe("reduceCoordinatePrecision", () => {
  it("should round to the configured decimal places", () => {
    const result = reduceCoordinatePrecision(-1.29213456, 36.82197654);
    expect(result.latitude).toBe(-1.29);
    expect(result.longitude).toBe(36.82);
  });

  it("should accept a custom precision", () => {
    const result = reduceCoordinatePrecision(-1.29213456, 36.82197654, 1);
    expect(result.latitude).toBe(-1.3);
    expect(result.longitude).toBe(36.8);
  });

  it("should preserve the origin", () => {
    expect(reduceCoordinatePrecision(0, 0)).toEqual({ latitude: 0, longitude: 0 });
  });

  it("should keep the point within roughly a kilometre of the original", () => {
    const lat = -1.29213456;
    const lon = 36.82197654;
    const reduced = reduceCoordinatePrecision(lat, lon);

    const driftKm = calculateDistance(lat, lon, reduced.latitude, reduced.longitude);
    expect(driftKm).toBeLessThan(1.5);
  });

  it("should default to two decimals", () => {
    expect(REDUCED_PRECISION_DECIMALS).toBe(2);
  });
});
