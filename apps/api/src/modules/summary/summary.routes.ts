import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const summaryRouter = Router();
summaryRouter.get("/", notImplementedHandler("GET /api/v1/summary"));
