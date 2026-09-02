import { createApiClient } from "@kkd/api-client";

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000",
});
