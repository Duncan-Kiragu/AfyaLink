import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const locationRouter = Router();
locationRouter.post("/search", notImplementedHandler("POST /api/v1/location/search"));
