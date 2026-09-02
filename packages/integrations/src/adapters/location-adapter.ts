import { type Coordinates } from "@kkd/contracts";

/**
 * Server-side geocoding only.
 *
 * Browser geolocation (`navigator.geolocation`) deliberately does NOT live here:
 * this package runs inside the Express API and the BullMQ worker, where
 * `navigator` is undefined. Acquiring device coordinates is the web app's job
 * (see apps/web/src/features/provider-search/useBrowserLocation.ts); the server
 * only ever receives coordinates that the client already obtained with consent.
 */
export interface GeocodingAdapter {
  geocodeManualLocation(query: string): Promise<Coordinates[]>;
}

const CITY_COORDINATES: Record<string, Omit<Coordinates, "timestamp">> = {
  nairobi: { latitude: -1.2921, longitude: 36.8219, accuracy: 5000 },
  mombasa: { latitude: -4.043, longitude: 39.668, accuracy: 5000 },
  kisumu: { latitude: -0.1019, longitude: 34.7617, accuracy: 5000 },
  nakuru: { latitude: -0.3031, longitude: 36.0801, accuracy: 5000 },
  eldoret: { latitude: 0.5143, longitude: 35.2799, accuracy: 5000 },
};

/**
 * Fixture-backed geocoder covering the cities in the mock provider directory.
 * Swap for a real GEO_PROVIDER adapter without changing callers.
 *
 * Spec 9.3: only the area string is sent here - never symptom text.
 */
export class GeocodingAdapterImpl implements GeocodingAdapter {
  async validateConfig(): Promise<void> {
    // Fixture-backed geocoder needs no external credentials.
  }

  async geocodeManualLocation(query: string): Promise<Coordinates[]> {
    const normalized = query.toLowerCase().trim();

    // Accept "Westlands, Nairobi" by matching any known city token in the query.
    const match =
      CITY_COORDINATES[normalized] ??
      Object.entries(CITY_COORDINATES).find(([city]) =>
        normalized.split(/[\s,]+/).includes(city)
      )?.[1];

    if (!match) {
      throw new Error(`Location not found: ${query}`);
    }

    return [{ ...match, timestamp: new Date().toISOString() }];
  }
}
