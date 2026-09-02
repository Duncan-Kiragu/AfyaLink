import express from "express";

export const healthApp = express();

healthApp.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

healthApp.get("/ready", (_req, res) => {
  res.status(503).json({ status: "not_wired" });
});
