import { MockProviderAdapter } from "@kkd/integrations";
import { type ProviderSyncPayload, type CareCategory } from "@kkd/contracts";
import { createLogger } from "@kkd/observability";

const logger = createLogger("provider-sync");
const adapter = new MockProviderAdapter();

const CARE_CATEGORIES: CareCategory[] = [
  "emergency_department",
  "urgent_care",
  "primary_care",
  "paediatrics",
  "obstetric_care",
  "eye_care",
  "dental_care",
  "mental_health",
  "pharmacy",
  "laboratory",
  "telemedicine",
];

const DEFAULT_LOCATIONS = ["nairobi", "mombasa", "kisumu"];

export async function processProviderSync(payload?: ProviderSyncPayload): Promise<void> {
  const startTime = Date.now();

  try {
    await adapter.validateConfig();

    const categories = payload?.careCategories ?? CARE_CATEGORIES;
    // Area names only - the adapter geocodes them. No coordinates are invented
    // here; passing 0,0 would be a real point in the Gulf of Guinea.
    const locations: NonNullable<ProviderSyncPayload["locations"]> =
      payload?.locations ?? DEFAULT_LOCATIONS.map((name) => ({ name }));

    logger.info(
      { event: "provider_sync_started", status: `${categories.length}x${locations.length}` },
      "provider-sync: starting sync"
    );

    let totalProviders = 0;

    for (const category of categories) {
      for (const location of locations) {
        try {
          const providers = await adapter.search({
            careCategory: category,
            latitude: location.latitude,
            longitude: location.longitude,
            areaQuery: location.name,
          });
          totalProviders += providers.length;
        } catch (error) {
          logger.warn(
            {
              event: "provider_sync_search_failed",
              status: error instanceof Error ? error.message : "unknown",
            },
            "provider-sync: search failed"
          );
        }
      }
    }

    logger.info(
      {
        event: "provider_sync_completed",
        status: String(totalProviders),
        latencyMs: Date.now() - startTime,
      },
      "provider-sync: completed"
    );
  } catch (error) {
    logger.error(
      {
        event: "provider_sync_failed",
        status: error instanceof Error ? error.message : "unknown",
        latencyMs: Date.now() - startTime,
      },
      "provider-sync: failed"
    );
    throw error;
  }
}
