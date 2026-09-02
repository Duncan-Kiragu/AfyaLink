import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const scoresRouter = Router();
scoresRouter.get("/", notImplementedHandler("GET /api/v1/scores"));
