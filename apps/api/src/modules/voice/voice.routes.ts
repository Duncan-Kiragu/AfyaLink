import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const voiceRouter = Router();
voiceRouter.post("/callback", notImplementedHandler("POST /api/v1/voice/callback"));
