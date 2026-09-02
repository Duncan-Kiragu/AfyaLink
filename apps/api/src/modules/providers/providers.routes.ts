import { Router } from "express";
import { providerSearchInputSchema } from "@kkd/contracts";
import { ProvidersService } from "./providers.service.js";

export const providersRouter = Router();
const providersService = new ProvidersService();

providersRouter.get("/search", async (req, res) => {
  try {
    const input = providerSearchInputSchema.parse({
      careCategory: req.query.careCategory,
      latitude:
        req.query.latitude !== undefined
          ? Number(req.query.latitude)
          : undefined,
      longitude:
        req.query.longitude !== undefined
          ? Number(req.query.longitude)
          : undefined,
      areaQuery: req.query.areaQuery,
      urgency: req.query.urgency,
    });

    const { providers, degraded } = await providersService.searchProviders(input);

    res.json({
      providers,
      searchMetadata: {
        careCategory: input.careCategory,
        urgency: input.urgency,
        resultCount: providers.length,
        degraded,
        // Spec 9.5.E - live availability can change between refreshes.
        freshnessDisclaimer:
          "Opening hours and availability can change. Call ahead to confirm.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider search failed";
    res.status(400).json({ error: message });
  }
});

providersRouter.get("/:providerId/details", async (req, res) => {
  try {
    const provider = await providersService.getProviderDetails(req.params.providerId);
    res.json(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider not found";
    res.status(404).json({ error: message });
  }
});
