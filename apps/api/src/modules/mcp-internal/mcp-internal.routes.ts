import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const mcpInternalRouter = Router();
mcpInternalRouter.post("/", notImplementedHandler("POST /api/v1/mcp-internal"));
