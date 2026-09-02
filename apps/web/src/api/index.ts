import { createApiClient } from "@kkd/api-client";
import { getDemoUserId } from "../lib/demoUserId";

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000",
  getHeaders: () => ({
    "x-kkd-user-id": getDemoUserId(),
  }),
});
