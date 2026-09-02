import { Router } from "express";
import { notImplementedHandler } from "../../lib/not-implemented.js";

export const conversationRouter = Router();
conversationRouter.post("/", notImplementedHandler("POST /api/v1/conversation"));
