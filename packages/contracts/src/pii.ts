import { z } from "zod";

export const piiClassSchema = z.enum([
  "person_name",
  "phone",
  "email",
  "national_id",
  "address",
  "coordinates",
  "account_reference",
  "date_of_birth",
  "org_identifier",
]);
export type PiiClass = z.infer<typeof piiClassSchema>;

export const piiFindingSchema = z.object({
  type: piiClassSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type PiiFinding = z.infer<typeof piiFindingSchema>;

export const piiPolicySchema = z.enum(["log", "ai", "job", "webhook", "analytics", "session_reversible"]);
export type PiiPolicy = z.infer<typeof piiPolicySchema>;

export interface PiiService {
  detect(text: string): Promise<PiiFinding[]>;
  sanitizeObject<T>(value: T, policy: PiiPolicy): Promise<T>;
}
