import { Router } from "express";
import { z } from "zod";
import { urgencyClassSchema } from "@kkd/contracts";
import { LocationService } from "./location.service.js";

export const locationRouter = Router();
const locationService = new LocationService();

const locationSearchSchema = z
  .object({
    method: z.enum(["browser", "manual"]),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().positive().optional(),
    areaQuery: z.string().min(1).max(255).optional(),
    urgency: urgencyClassSchema.optional(),
    sessionId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.method === "manual"
        ? Boolean(v.areaQuery)
        : v.latitude !== undefined && v.longitude !== undefined,
    { message: "browser requires latitude/longitude; manual requires areaQuery" }
  );

locationRouter.post("/search", async (req, res) => {
  try {
    const input = locationSearchSchema.parse(req.body);
    const location = await locationService.resolveLocation(input);

    res.json({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      timestamp: location.timestamp,
      method: location.method,
      precision: location.precision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Location search failed";
    res.status(400).json({ error: message });
  }
});

/**
 * Spec 9.5.A.5 / 9.6 - clearing an anonymous session leaves no precise
 * coordinates behind. Idempotent: clearing an unknown session is not an error.
 */
locationRouter.delete("/session/:sessionId", (req, res) => {
  locationService.clearSessionLocation(req.params.sessionId);
  res.status(204).send();
});
