import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const severityRouter = Router();
severityRouter.post("/evaluate", notImplementedHandler("POST /api/v1/severity/evaluate"));
