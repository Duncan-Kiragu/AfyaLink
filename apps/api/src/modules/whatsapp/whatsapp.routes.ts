import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const whatsappRouter = Router();
whatsappRouter.get("/", notImplementedHandler("GET /api/v1/integrations/whatsapp webhook verify"));
whatsappRouter.post("/", notImplementedHandler("POST /api/v1/integrations/whatsapp webhook"));
