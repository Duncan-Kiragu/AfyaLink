import { type ProviderSearchInput, type NormalizedProvider } from "@kkd/contracts";
import { MockProviderAdapter, rankProviders } from "@kkd/integrations";
import { createLogger } from "@kkd/observability";

const logger = createLogger("providers");

export interface ProviderSearchResult {
  providers: NormalizedProvider[];
  /** False when the upstream directory failed and we degraded to no results. */
  degraded: boolean;
}

export class ProvidersService {
  private adapter: MockProviderAdapter;

  constructor(adapter: MockProviderAdapter = new MockProviderAdapter()) {
    this.adapter = adapter;
  }

  /**
   * Search for providers matching care category and location.
   * Results are ranked by safety-relevant criteria (category + urgency first).
   *
   * Spec 9.6: adapter failures degrade gracefully - the caller gets an empty,
   * explicitly-degraded result instead of a 500, so the UI can still offer
   * manual entry and emergency guidance.
   */
  async searchProviders(input: ProviderSearchInput): Promise<ProviderSearchResult> {
    try {
      await this.adapter.validateConfig();
      const providers = await this.adapter.search(input);

      if (providers.length === 0) {
        return { providers: [], degraded: false };
      }

      return { providers: rankProviders(providers, input), degraded: false };
    } catch (error) {
      // Log the failure shape only - never the search coordinates (spec 9.3).
      logger.warn(
        {
          event: "provider_search_degraded",
          status: error instanceof Error ? error.message : "unknown",
        },
        "provider search failed; degrading to empty results"
      );
      return { providers: [], degraded: true };
    }
  }

  async getProviderDetails(providerId: string): Promise<NormalizedProvider> {
    return this.adapter.getDetails(providerId);
  }
}
