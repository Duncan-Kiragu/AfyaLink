import type { ConversationChannelAdapter, ExternalApiAdapter } from "@kkd/contracts";

export type { ConversationChannelAdapter, ExternalApiAdapter };

export const adapterFolders = [
  "geo",
  "providers",
  "whatsapp",
  "ussd",
  "voice",
] as const;

export function unimplementedAdapter(name: string): never {
  throw new Error(`@kkd/integrations ${name} adapter is not implemented`);
}

// Provider directory + geolocation (workstream 5)
export { MockProviderAdapter } from "./adapters/provider-adapter.js";
export {
  GeocodingAdapterImpl,
  type GeocodingAdapter,
} from "./adapters/location-adapter.js";
export { rankProviders, calculateDistance } from "./ranking.js";
export { reduceCoordinatePrecision, REDUCED_PRECISION_DECIMALS } from "./precision.js";
export {
  ALL_MOCK_PROVIDERS,
  MOCK_PROVIDERS_BY_LOCATION,
  getMockProvidersByCategory,
} from "./mock-provider-data.js";
