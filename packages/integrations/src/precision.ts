/**
 * Decimal places retained when reducing coordinate precision.
 * 2dp is roughly a 1.1km grid cell at the equator - enough to rank providers
 * in a neighbourhood, not enough to identify a household.
 */
export const REDUCED_PRECISION_DECIMALS = 2;

/**
 * Spec 9.5.A.4 - configurable precision reduction for non-emergency searches.
 *
 * Emergency searches keep exact coordinates: getting the patient to the right
 * door matters more than the marginal privacy gain. Every other urgency class
 * is snapped to a coarse grid before it reaches any provider/geocoding API.
 */
export function reduceCoordinatePrecision(
  latitude: number,
  longitude: number,
  decimals: number = REDUCED_PRECISION_DECIMALS
): { latitude: number; longitude: number } {
  const factor = 10 ** decimals;
  return {
    latitude: Math.round(latitude * factor) / factor,
    longitude: Math.round(longitude * factor) / factor,
  };
}
