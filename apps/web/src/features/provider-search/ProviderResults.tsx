import { type NormalizedProvider } from "@kkd/contracts";
import { ProviderCard } from "./ProviderCard";

interface ProviderResultsProps {
  providers: NormalizedProvider[];
  userLat?: number;
  userLon?: number;
  isLoading?: boolean;
  /** Timestamp of the search, used to render provider data freshness. */
  asOf: number;
}

export function ProviderResults({
  providers,
  userLat,
  userLon,
  isLoading,
  asOf,
}: ProviderResultsProps) {
  const calculateDistance = (providerLat: number, providerLon: number): number | undefined => {
    // 0 is a valid coordinate - compare against undefined, not truthiness.
    if (userLat === undefined || userLon === undefined) return undefined;
    const R = 6371;
    const dLat = toRad(providerLat - userLat);
    const dLon = toRad(providerLon - userLon);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(userLat)) *
        Math.cos(toRad(providerLat)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  if (isLoading) {
    return (
      <div className="provider-results loading">
        <p>Finding nearby providers...</p>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="provider-results empty">
        <h3>No providers found</h3>
        <p>Try entering a different location or searching for a different type of care.</p>
      </div>
    );
  }

  return (
    <div className="provider-results">
      <div className="results-header">
        <h2>Nearby Healthcare Services</h2>
        <p className="result-count">Found {providers.length} provider{providers.length !== 1 ? "s" : ""}</p>
        {/* Spec 9.5.E - live availability can change between refreshes. */}
        <p className="freshness-note">
          Opening hours and availability can change. Call ahead to confirm.
        </p>
      </div>

      <div className="provider-list">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            asOf={asOf}
            distance={
              provider.latitude !== undefined && provider.longitude !== undefined
                ? calculateDistance(provider.latitude, provider.longitude)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
