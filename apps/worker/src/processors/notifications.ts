import { notificationJobSchema } from "@kkd/contracts";

export async function processNotifications(data: unknown): Promise<void> {
  notificationJobSchema.parse(data);
  throw new Error("notifications processor is not implemented");
}
