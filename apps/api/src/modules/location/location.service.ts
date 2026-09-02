import {
  type Coordinates,
  type LocationPrecision,
  type UrgencyClass,
  coordinatesSchema,
} from "@kkd/contracts";
import { GeocodingAdapterImpl, reduceCoordinatePrecision } from "@kkd/integrations";
import {
  ephemeralLocationStore,
  type EphemeralLocationStore,
} from "./ephemeral-location.store.js";

export interface ResolveLocationInput {
  method: "browser" | "manual";
  /** Supplied by the web app for `browser`; it owns navigator.geolocation. */
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  areaQuery?: string;
  urgency?: UrgencyClass;
  sessionId?: string;
}

export interface ResolvedLocation extends Coordinates {
  method: "browser" | "manual";
  precision: LocationPrecision;
}

export class LocationService {
  private adapter: GeocodingAdapterImpl;
  private store: EphemeralLocationStore;

  constructor(
    adapter: GeocodingAdapterImpl = new GeocodingAdapterImpl(),
    store: EphemeralLocationStore = ephemeralLocationStore
  ) {
    this.adapter = adapter;
    this.store = store;
  }

  /**
   * Resolve coordinates for a provider search.
   *
   * `browser` coordinates arrive from the client (which already obtained
   * consent); `manual` area strings are geocoded server-side. Spec 9.5.A.4:
   * non-emergency searches get reduced precision before the coordinates are
   * stored or forwarded to any external API.
   */
  async resolveLocation(input: ResolveLocationInput): Promise<ResolvedLocation> {
    const raw = await this.acquireCoordinates(input);

    const shouldReduce = input.urgency !== "emergency";
    const precision: LocationPrecision = shouldReduce ? "reduced" : "exact";
    const { latitude, longitude } = shouldReduce
      ? reduceCoordinatePrecision(raw.latitude, raw.longitude)
      : { latitude: raw.latitude, longitude: raw.longitude };

    const resolved: ResolvedLocation = {
      latitude,
      longitude,
      accuracy: raw.accuracy,
      timestamp: raw.timestamp,
      method: input.method,
      precision,
    };

    // Ephemeral only - never persisted to Supabase (spec 9.3).
    if (input.sessionId) {
      this.store.set(input.sessionId, {
        latitude,
        longitude,
        accuracy: raw.accuracy,
        precision,
        method: input.method,
      });
    }

    return resolved;
  }

  private async acquireCoordinates(input: ResolveLocationInput): Promise<Coordinates> {
    if (input.method === "browser") {
      if (input.latitude === undefined || input.longitude === undefined) {
        throw new Error(
          "Browser location requires latitude and longitude from the client"
        );
      }
      return {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
        timestamp: new Date().toISOString(),
      };
    }

    if (input.method === "manual") {
      if (!input.areaQuery) {
        throw new Error("Manual location requires an areaQuery");
      }
      const results = await this.adapter.geocodeManualLocation(input.areaQuery);
      const first = results[0];
      if (!first) {
        throw new Error(`No coordinates found for: ${input.areaQuery}`);
      }
      return first;
    }

    throw new Error("Invalid location search parameters");
  }

  /** Spec 9.5.A.5 - clear location state when the anonymous session closes. */
  clearSessionLocation(sessionId: string): boolean {
    return this.store.clear(sessionId);
  }

  getSessionLocation(sessionId: string) {
    return this.store.get(sessionId);
  }

  validateCoordinates(coords: Coordinates): boolean {
    return coordinatesSchema.safeParse(coords).success;
  }
}
