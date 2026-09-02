import { Router } from "express";
import { getEnv } from "../../services/context.js";
import { pingRedis } from "../../services/redis.js";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

healthRouter.get("/ready", async (_req, res) => {
  const env = getEnv();
  const redis = await pingRedis(env.REDIS_URL);
  // Redis is the only home for ephemeral clinical sessions, so an API that
  // cannot reach it is not ready to accept clinical traffic (spec §20).
  const ready = redis;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "degraded",
    redis,
    channels: {
      whatsapp: env.FEATURE_WHATSAPP,
      ussd: env.FEATURE_USSD,
    },
  });
});
