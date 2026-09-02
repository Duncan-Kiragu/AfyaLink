import { z } from "zod";

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  timestamp: z.string().datetime(),
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

export const locationInputSchema = z.object({
  method: z.enum(["browser", "manual"]),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  areaQuery: z.string().min(1).max(255).optional(),
});
export type LocationInput = z.infer<typeof locationInputSchema>;

export const locationConsentSchema = z.object({
  sessionId: z.string().uuid(),
  method: z.enum(["browser", "manual"]),
  permissionGranted: z.boolean(),
  consentVersion: z.string(),
  recordedAt: z.string().datetime(),
});
export type LocationConsent = z.infer<typeof locationConsentSchema>;

export const locationSearchRequestSchema = z.object({
  method: z.enum(["browser", "manual"]),
  areaQuery: z.string().min(1).max(255).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type LocationSearchRequest = z.infer<typeof locationSearchRequestSchema>;

export const locationSearchResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  timestamp: z.string().datetime(),
  method: z.enum(["browser", "manual"]),
});
export type LocationSearchResponse = z.infer<typeof locationSearchResponseSchema>;

/**
 * Precision applied to coordinates before they leave the request boundary.
 * Spec 9.5.A.4 - non-emergency searches may reduce precision.
 */
export const locationPrecisionSchema = z.enum(["exact", "reduced"]);
export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;

/**
 * An ephemeral, TTL-bound location held for the lifetime of a clinic session.
 * Spec 9.3 - precise coordinates in anonymous mode never reach Supabase.
 */
export const ephemeralLocationSchema = z.object({
  sessionId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  precision: locationPrecisionSchema,
  method: z.enum(["browser", "manual"]),
  storedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type EphemeralLocation = z.infer<typeof ephemeralLocationSchema>;
