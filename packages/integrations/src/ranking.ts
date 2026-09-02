import {
  type NormalizedProvider,
  type ProviderSearchInput,
  type UrgencyClass,
} from "@kkd/contracts";

interface ProviderScore {
  provider: NormalizedProvider;
  score: number;
  scores: {
    careCategory: number;
    emergency: number;
    verified: number;
    distance: number;
    openingStatus: number;
  };
}

const OPENING_STATUS_PRIORITY = {
  open_24h: 100,
  open_now: 80,
  open: 60,
  unknown: 0,
};

/**
 * Rank providers by safety-relevant criteria, NOT distance alone.
 *
 * Priority order:
 * 1. careCategory match (filter, not scored)
 * 2. Emergency capability (when urgency=emergency)
 * 3. Verified data (< 30 days)
 * 4. Distance (if coordinates available)
 * 5. Opening status
 */
export function rankProviders(
  providers: NormalizedProvider[],
  input: ProviderSearchInput
): NormalizedProvider[] {
  // Filter by care category
  const filtered = providers.filter((p) =>
    p.careCategories.includes(input.careCategory)
  );

  if (filtered.length === 0) {
    return [];
  }

  // Score each provider
  const scored: ProviderScore[] = filtered.map((provider) => {
    const scores = {
      careCategory: 100, // All filtered providers match
      emergency: scoreEmergency(provider, input.urgency),
      verified: scoreVerified(provider),
      distance:
        input.latitude !== undefined && input.longitude !== undefined
          ? scoreDistance(provider, input.latitude, input.longitude)
          : 50, // Neutral score if no coordinates
      openingStatus: scoreOpeningStatus(provider),
    };

    // Weighted total (higher weights for safety-critical factors)
    const score =
      scores.careCategory * 0.3 + // 30% - care category match (all same, tiebreaker only)
      scores.emergency * 0.4 + // 40% - emergency capability (safety critical)
      scores.verified * 0.15 + // 15% - data freshness (reliability)
      scores.distance * 0.1 + // 10% - distance (convenience)
      scores.openingStatus * 0.05; // 5% - opening status (availability)

    return { provider, score, scores };
  });

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score).map((s) => s.provider);
}

/**
 * Score emergency capability.
 * When urgency is emergency, emergency departments score highest.
 */
function scoreEmergency(
  provider: NormalizedProvider,
  urgency: UrgencyClass | undefined
): number {
  if (urgency !== "emergency") {
    return 50; // Neutral for non-emergency
  }

  const isEmergencyDept = provider.careCategories.includes("emergency_department");
  return isEmergencyDept ? 100 : 0;
}

/**
 * Score data freshness.
 * Providers verified < 30 days score 100, older score less.
 */
function scoreVerified(provider: NormalizedProvider): number {
  const lastVerified = new Date(provider.lastVerifiedAt);
  const daysSince = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < 30) {
    return 100;
  }

  if (daysSince < 60) {
    return 75;
  }

  if (daysSince < 90) {
    return 50;
  }

  return 25;
}

/**
 * Score distance.
 * Closer providers score higher.
 */
function scoreDistance(
  provider: NormalizedProvider,
  userLat: number,
  userLon: number
): number {
  if (provider.latitude === undefined || provider.longitude === undefined) {
    return 0; // No coordinates = can't score distance
  }

  const distance = calculateDistance(userLat, userLon, provider.latitude, provider.longitude);

  // Scoring: 0km = 100, 50km = 0, linear interpolation
  if (distance <= 0) return 100;
  if (distance >= 50) return 0;
  return 100 - (distance / 50) * 100;
}

/**
 * Score opening status.
 */
function scoreOpeningStatus(provider: NormalizedProvider): number {
  const status = provider.openingStatus || "unknown";
  return (
    OPENING_STATUS_PRIORITY[status as keyof typeof OPENING_STATUS_PRIORITY] || 0
  );
}

/**
 * Calculate distance between two coordinates using Haversine formula.
 * Returns distance in kilometers.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
