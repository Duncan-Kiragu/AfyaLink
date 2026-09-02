import { Router, type Request, type Response } from "express";
import {
  acknowledgeDisclosureInputSchema,
  startSessionInputSchema,
  submitMessageInputSchema,
} from "@kkd/contracts";
import { getChannelContext } from "../../services/context.js";
import { getDisclosure } from "../../services/disclosure.js";

/**
 * Product session routes.
 *
 * These call the *same* `ConversationEngine` the WhatsApp and USSD adapters
 * call. That is the whole point of the shared engine: the web client and the
 * channel adapters cannot drift apart clinically (spec §3.1, §11.2).
 */

export const sessionsRouter = Router();

sessionsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = startSessionInputSchema.safeParse({ channel: "web", ...req.body });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { engine } = getChannelContext();
  const turn = await engine.startSession(parsed.data);
  res.status(201).json({
    ...turn,
    disclosure: getDisclosure(parsed.data.channel, turn.session.locale),
  });
});

sessionsRouter.get("/:id", async (req: Request, res: Response) => {
  const { engine } = getChannelContext();
  const turn = await engine.getSession(String(req.params.id));
  if (!turn) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  res.status(200).json(turn);
});

sessionsRouter.post("/:id/disclosure", async (req: Request, res: Response) => {
  const parsed = acknowledgeDisclosureInputSchema.safeParse({
    sessionId: String(req.params.id),
    ...req.body,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { engine } = getChannelContext();
  res.status(200).json(await engine.acknowledgeDisclosure(parsed.data));
});

sessionsRouter.post("/:id/messages", async (req: Request, res: Response) => {
  const parsed = submitMessageInputSchema.safeParse({
    sessionId: String(req.params.id),
    ...req.body,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { engine } = getChannelContext();
  res.status(200).json(await engine.submitPatientMessage(parsed.data));
});

sessionsRouter.get("/:id/summary", async (req: Request, res: Response) => {
  const { engine } = getChannelContext();
  res.status(200).json(await engine.getSummary(String(req.params.id)));
});

sessionsRouter.post("/:id/close", async (req: Request, res: Response) => {
  const { engine } = getChannelContext();
  await engine.closeSession(String(req.params.id));
  // 204: nothing to return, and the ephemeral content is already deleted.
  res.status(204).end();
});
