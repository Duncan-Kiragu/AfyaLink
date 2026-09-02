import { type NormalizedProvider } from "@kkd/contracts";

interface ProviderCardProps {
  provider: NormalizedProvider;
  distance?: number;
  /**
   * "Now" as of the search, passed in so this component stays pure.
   * Spec 9.5.E - freshness is shown relative to when results were fetched.
   */
  asOf: number;
}

export function ProviderCard({ provider, distance, asOf }: ProviderCardProps) {
  const handleCall = () => {
    if (provider.phone) {
      window.location.href = `tel:${provider.phone}`;
    }
  };

  const handleDirections = () => {
    if (provider.latitude !== undefined && provider.longitude !== undefined) {
      const mapsUrl = `https://maps.google.com/?q=${provider.latitude},${provider.longitude}`;
      window.open(mapsUrl, "_blank");
    }
  };

  const handleBooking = () => {
    if (provider.bookingUrl) {
      window.open(provider.bookingUrl, "_blank");
    }
  };

  const verifiedAt = Date.parse(provider.lastVerifiedAt ?? "");
  const daysAgo = Number.isNaN(verifiedAt)
    ? null
    : Math.floor((asOf - verifiedAt) / (1000 * 60 * 60 * 24));

  return (
    <div className="provider-card">
      <div className="provider-header">
        <h3>{provider.name}</h3>
        <span className="facility-type">{provider.facilityType}</span>
      </div>

      <div className="provider-info">
        <p className="address">{provider.address}</p>

        <div className="meta">
          {distance !== undefined && <span className="distance">{distance.toFixed(1)} km away</span>}
          {provider.openingStatus && <span className="status">{provider.openingStatus}</span>}
          {daysAgo !== null && (
            <span className="verified">
              Verified {daysAgo === 0 ? "today" : `${daysAgo} days ago`}
            </span>
          )}
        </div>

        <div className="categories">
          {provider.careCategories.map((cat) => (
            <span key={cat} className="category">
              {formatCategory(cat)}
            </span>
          ))}
        </div>
      </div>

      <div className="actions">
        {provider.phone && (
          <button onClick={handleCall} className="btn-call">
            📞 Call
          </button>
        )}
        {provider.latitude !== undefined && provider.longitude !== undefined && (
          <button onClick={handleDirections} className="btn-directions">
            📍 Directions
          </button>
        )}
        {provider.bookingUrl && (
          <button onClick={handleBooking} className="btn-book">
            📅 Book
          </button>
        )}
      </div>
    </div>
  );
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
