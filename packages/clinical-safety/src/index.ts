import type { SafetyAssessment } from "@kkd/contracts";
import { z } from "zod";

// Care-category routing (workstream 5)
export { routeToCareCategory, type CareRoutingInput } from "./care-routing.js";

export const safetyRuleSchema = z.object({
  id: z.string(),
  version: z.string(),
  status: z.enum(["draft", "active", "retired"]),
  requiredInputs: z.array(z.string()),
  urgencyResult: z.string(),
  patientMessageKey: z.string(),
  clinicalRationale: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
});
export type SafetyRule = z.infer<typeof safetyRuleSchema>;

export interface DiagnosisLanguageGuard {
  inspect(text: string, locale: string): Promise<{ allowed: boolean; reason?: string }>;
}

export interface SafetyEngine {
  evaluate(session: unknown): Promise<SafetyAssessment>;
}

export class UnimplementedSafetyEngine implements SafetyEngine {
  evaluate(_session: unknown): Promise<SafetyAssessment> {
    return Promise.reject(new Error("@kkd/clinical-safety evaluate is not implemented"));
  }
}
