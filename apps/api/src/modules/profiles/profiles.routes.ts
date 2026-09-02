import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const profilesRouter = Router();
profilesRouter.post("/followups", notImplementedHandler("POST /api/v1/profile/followups"));
profilesRouter.delete(
  "/followups/:id",
  notImplementedHandler("DELETE /api/v1/profile/followups/:id"),
);
