import express from "express";
import { requestId } from "./middleware/request-id.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { createCors } from "./middleware/cors.js";
import { auth } from "./middleware/auth.js";
import { rateLimiter } from "./middleware/rate-limit.js";
import { telemetry } from "./middleware/telemetry.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { sessionsRouter } from "./modules/sessions/sessions.routes.js";
import { conversationRouter } from "./modules/conversation/conversation.routes.js";
import { summaryRouter } from "./modules/summary/summary.routes.js";
import { recordsRouter } from "./modules/records/records.routes.js";
import { scoresRouter } from "./modules/scores/scores.routes.js";
import { severityRouter } from "./modules/severity/severity.routes.js";
import { profilesRouter } from "./modules/profiles/profiles.routes.js";
import { providersRouter } from "./modules/providers/providers.routes.js";
import { locationRouter } from "./modules/location/location.routes.js";
import { integrationsRouter } from "./modules/integrations/integrations.routes.js";
import { whatsappRouter } from "./modules/whatsapp/whatsapp.routes.js";
import { ussdRouter } from "./modules/ussd/ussd.routes.js";
import { voiceRouter } from "./modules/voice/voice.routes.js";
import { mcpInternalRouter } from "./modules/mcp-internal/mcp-internal.routes.js";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(securityHeaders);
  app.use(createCors());
  app.use(express.json({ limit: "100kb" }));
  app.use(auth);
  app.use(rateLimiter);
  app.use(telemetry);

  const v1 = express.Router();
  v1.use("/health", healthRouter);
  v1.use("/sessions", sessionsRouter);
  v1.use("/conversation", conversationRouter);
  v1.use("/summary", summaryRouter);
  v1.use("/records", recordsRouter);
  v1.use("/scores", scoresRouter);
  v1.use("/severity", severityRouter);
  v1.use("/profile", profilesRouter);
  v1.use("/providers", providersRouter);
  v1.use("/location", locationRouter);
  v1.use("/integrations", integrationsRouter);
  v1.use("/integrations/whatsapp", whatsappRouter);
  v1.use("/integrations/ussd", ussdRouter);
  v1.use("/voice", voiceRouter);
  v1.use("/mcp-internal", mcpInternalRouter);

  app.use("/api/v1", v1);
  app.use(errorHandler);
  return app;
}
