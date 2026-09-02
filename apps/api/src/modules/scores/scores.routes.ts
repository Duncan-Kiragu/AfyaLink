import { Router } from "express";

export const scoresRouter = Router();

scoresRouter.get("/", (_req, res) => {
  res.status(404).json({
    error: "use_record_scores",
    path: "/api/v1/records/:id/scores",
  });
});
