import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const recordsRouter = Router();
recordsRouter.get("/", notImplementedHandler("GET /api/v1/records"));
recordsRouter.post("/", notImplementedHandler("POST /api/v1/records"));
recordsRouter.get("/:id/entries", notImplementedHandler("GET /api/v1/records/:id/entries"));
recordsRouter.post("/:id/entries", notImplementedHandler("POST /api/v1/records/:id/entries"));
recordsRouter.get("/:id/scores", notImplementedHandler("GET /api/v1/records/:id/scores"));
recordsRouter.post("/:id/export", notImplementedHandler("POST /api/v1/records/:id/export"));
recordsRouter.delete("/:id", notImplementedHandler("DELETE /api/v1/records/:id"));
