import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const integrationsRouter = Router();
integrationsRouter.get("/", notImplementedHandler("GET /api/v1/integrations"));
