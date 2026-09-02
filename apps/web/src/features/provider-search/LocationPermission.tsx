import { useBrowserLocation, type BrowserCoordinates } from "./useBrowserLocation";

interface LocationPermissionProps {
  onLocationFound: (coords: BrowserCoordinates) => void;
  onManualEntry: () => void;
}

export function LocationPermission({
  onLocationFound,
  onManualEntry,
}: LocationPermissionProps) {
  const { request, isRequesting, error } = useBrowserLocation();

  // Spec 9.5.B - denial must never block care search; fall back to manual.
  const handleUseMyLocation = async () => {
    try {
      onLocationFound(await request());
    } catch {
      onManualEntry();
    }
  };

  return (
    <div className="location-permission">
      <h2>Find care near you</h2>

      {/* Spec 9.5.A.1 - explain before asking. */}
      <p>
        We use your location only to list nearby health services and work out how
        far away they are. Your symptoms are never sent to mapping services.
      </p>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className="buttons">
        <button type="button" onClick={handleUseMyLocation} disabled={isRequesting}>
          {isRequesting ? "Detecting location…" : "Use my location"}
        </button>
        <button type="button" className="secondary" onClick={onManualEntry}>
          Enter location manually
        </button>
      </div>

      <p className="privacy-note">
        Your location is used only for this search and is cleared when this
        session ends.
      </p>
    </div>
  );
}
