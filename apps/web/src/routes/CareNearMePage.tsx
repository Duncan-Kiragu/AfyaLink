import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { type NormalizedProvider } from "@kkd/contracts";
import { routeToCareCategory } from "@kkd/clinical-safety";
import { LocationPermission } from "../features/provider-search/LocationPermission";
import { ManualLocationInput } from "../features/provider-search/ManualLocationInput";
import { ProviderResults } from "../features/provider-search/ProviderResults";
import { useCareContext } from "../features/provider-search/useCareContext";
import type { BrowserCoordinates } from "../features/provider-search/useBrowserLocation";

type SearchState = "idle" | "manual" | "searching" | "results" | "error";

export function CareNearMePage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  const { urgency, reportedSymptoms, isLoading } = useCareContext(sessionId);

  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [providers, setProviders] = useState<NormalizedProvider[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [searchedAt, setSearchedAt] = useState(0);
  const [userLat, setUserLat] = useState<number>();
  const [userLon, setUserLon] = useState<number>();
  const [error, setError] = useState<string | null>(null);

  // Care category comes from approved routing rules, never disease inference.
  const careCategory = routeToCareCategory({ urgency, reportedSymptoms });

  // Spec 9.5.A.5 - drop server-side location state when leaving the flow.
  useEffect(() => {
    if (!sessionId) return;
    return () => {
      void fetch(`/api/v1/location/session/${sessionId}`, { method: "DELETE" });
    };
  }, [sessionId]);

  const performSearch = useCallback(
    async (coords?: BrowserCoordinates, areaQuery?: string) => {
      setSearchState("searching");
      setError(null);

      try {
        // Resolve coordinates server-side so precision reduction and the
        // ephemeral store are applied consistently for both entry methods.
        const locationRes = await fetch("/api/v1/location/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            coords
              ? { method: "browser", ...coords, urgency, sessionId }
              : { method: "manual", areaQuery, urgency, sessionId }
          ),
        });

        const location = await locationRes.json();
        if (!locationRes.ok) {
          throw new Error(location.error || "Could not resolve that location");
        }

        setUserLat(location.latitude);
        setUserLon(location.longitude);

        const query = new URLSearchParams({
          careCategory,
          urgency,
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          ...(areaQuery ? { areaQuery } : {}),
        });

        const response = await fetch(`/api/v1/providers/search?${query}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Search failed");
        }

        setProviders(data.providers);
        setDegraded(Boolean(data.searchMetadata?.degraded));
        setSearchedAt(Date.now());
        setSearchState("results");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setSearchState("error");
      }
    },
    [careCategory, urgency, sessionId]
  );

  if (isLoading) {
    return (
      <main className="care-near-me-page">
        <p>Loading your session…</p>
      </main>
    );
  }

  return (
    <main className="care-near-me-page">
      <header>
        <h1>Find nearby healthcare</h1>
        {/* Spec 9.4 - describe the care type, never a condition. */}
        <p>
          Based on the type of care indicated by your answers, here are nearby{" "}
          {careCategory.replaceAll("_", " ")} services.
        </p>
      </header>

      {searchState === "idle" && (
        <LocationPermission
          onLocationFound={(coords) => performSearch(coords)}
          onManualEntry={() => setSearchState("manual")}
        />
      )}

      {searchState === "manual" && (
        <ManualLocationInput onSubmit={(area) => performSearch(undefined, area)} />
      )}

      {searchState === "searching" && (
        <div className="searching">
          <p>Finding nearby providers…</p>
        </div>
      )}

      {searchState === "results" && (
        <>
          {degraded && (
            <div className="notice" role="status">
              We could not reach the provider directory. Try again shortly, or
              call a service you already know.
            </div>
          )}
          <ProviderResults
            providers={providers}
            userLat={userLat}
            userLon={userLon}
            asOf={searchedAt}
          />
        </>
      )}

      {searchState === "error" && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setSearchState("idle")}>
            Try again
          </button>
          <button type="button" onClick={() => setSearchState("manual")}>
            Enter location manually
          </button>
        </div>
      )}
    </main>
  );
}
