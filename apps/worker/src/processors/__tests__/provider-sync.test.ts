import { describe, it, expect } from "vitest";
import type { ProviderSyncPayload } from "@kkd/contracts";
import { processProviderSync } from "../provider-sync.js";

describe("Provider Sync Processor", () => {
  it("should complete provider sync", async () => {
    await expect(processProviderSync()).resolves.not.toThrow();
  });

  it("should handle custom payload", async () => {
    const payload: ProviderSyncPayload = {
      careCategories: ["primary_care"],
      locations: [{ name: "nairobi", latitude: -1.3, longitude: 36.8 }],
    };
    await expect(processProviderSync(payload)).resolves.not.toThrow();
  });

  it("should handle empty payload", async () => {
    await expect(processProviderSync({})).resolves.not.toThrow();
  });
});
