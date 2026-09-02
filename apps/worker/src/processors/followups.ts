import { followupJobSchema } from "@kkd/contracts";

export async function processFollowups(data: unknown): Promise<void> {
  followupJobSchema.parse(data);
  throw new Error("followups processor is not implemented");
}
