import { providerSyncJobSchema } from "@kkd/contracts";

export async function processProviderSync(data: unknown): Promise<void> {
  providerSyncJobSchema.parse(data);
  throw new Error("provider-sync processor is not implemented");
}
