import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

healthRouter.get("/ready", (_req, res) => {
  res.status(503).json({
    status: "not_wired",
    redis: false,
    supabase: false,
  });
});
