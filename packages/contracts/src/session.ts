import { z } from "zod";
import { channelSchema, localeSchema, sessionModeSchema } from "./common.js";
import { assessmentCompletenessSchema, safetyAssessmentSchema } from "./safety.js";
import { reportedFactSchema, reportedSymptomSchema } from "./symptoms.js";

export const kkdSessionSchema = z.object({
  id: z.string(),
  mode: sessionModeSchema,
  channel: channelSchema,
  locale: localeSchema,
  createdAt: z.string(),
  lastActivityAt: z.string(),
  disclosureVersion: z.string(),
  facts: z.array(reportedFactSchema),
  symptoms: z.array(reportedSymptomSchema),
  safety: safetyAssessmentSchema,
  completion: assessmentCompletenessSchema,
});
export type KkdSession = z.infer<typeof kkdSessionSchema>;

export const redisKeyPrefixes = {
  session: (sessionId: string) => `kkd:session:${sessionId}`,
  ratelimit: (key: string) => `kkd:ratelimit:${key}`,
  cache: (provider: string, key: string) => `kkd:cache:${provider}:${key}`,
  lock: (resource: string) => `kkd:lock:${resource}`,
  bull: (queue: string) => `kkd:bull:${queue}`,
} as const;
