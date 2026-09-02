import { z } from "zod";
import { channelSchema, localeSchema } from "./common.js";

export const aiDisclosureSchema = z.object({
  id: z.string(),
  version: z.string(),
  locale: localeSchema,
  channel: channelSchema,
  text: z.string(),
  requiresAcknowledgement: z.boolean(),
});
export type AiDisclosure = z.infer<typeof aiDisclosureSchema>;
