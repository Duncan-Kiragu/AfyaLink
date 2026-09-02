import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const ussdRouter = Router();
ussdRouter.post("/", notImplementedHandler("POST /api/v1/integrations/ussd"));
