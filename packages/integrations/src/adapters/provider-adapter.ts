import {
  type ProviderDirectoryAdapter,
  type ProviderSearchInput,
  type NormalizedProvider,
} from "@kkd/contracts";
import { ALL_MOCK_PROVIDERS, getMockProvidersByCategory } from "../mock-provider-data.js";

export class MockProviderAdapter implements ProviderDirectoryAdapter {
  async validateConfig(): Promise<void> {
    // Mock adapter always passes validation
  }

  async search(input: ProviderSearchInput): Promise<NormalizedProvider[]> {
    // Get providers for the care category
    const providers = getMockProvidersByCategory(
      input.careCategory,
      input.areaQuery
    );

    if (providers.length === 0) {
      return [];
    }

    // Filter by location if provided.
    // Compare against undefined, not truthiness: latitude/longitude 0 are valid
    // coordinates (the equator and the prime meridian).
    if (input.latitude !== undefined && input.longitude !== undefined) {
      return this.filterByProximity(
        providers,
        input.latitude,
        input.longitude,
        50 // 50km radius
      );
    }

    return providers;
  }

  async getDetails(providerId: string): Promise<NormalizedProvider> {
    const provider = ALL_MOCK_PROVIDERS.find((p) => p.id === providerId);

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    return provider;
  }

  private filterByProximity(
    providers: NormalizedProvider[],
    latitude: number,
    longitude: number,
    radiusKm: number
  ): NormalizedProvider[] {
    return providers.filter((provider) => {
      if (provider.latitude === undefined || provider.longitude === undefined) {
        return false;
      }

      const distance = this.calculateDistance(
        latitude,
        longitude,
        provider.latitude,
        provider.longitude
      );

      return distance <= radiusKm;
    });
  }

  /**
   * Calculate distance between two coordinates using Haversine formula.
   * Returns distance in kilometers.
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
