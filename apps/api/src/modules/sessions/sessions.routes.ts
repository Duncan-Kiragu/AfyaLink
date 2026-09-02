import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const sessionsRouter = Router();
sessionsRouter.post("/", notImplementedHandler("POST /api/v1/sessions"));
sessionsRouter.get("/:id", notImplementedHandler("GET /api/v1/sessions/:id"));
sessionsRouter.post("/:id/messages", notImplementedHandler("POST /api/v1/sessions/:id/messages"));
sessionsRouter.get("/:id/summary", notImplementedHandler("GET /api/v1/sessions/:id/summary"));
sessionsRouter.post("/:id/close", notImplementedHandler("POST /api/v1/sessions/:id/close"));
