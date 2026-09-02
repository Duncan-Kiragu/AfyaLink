import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const providersRouter = Router();
providersRouter.get("/search", notImplementedHandler("GET /api/v1/providers/search"));
