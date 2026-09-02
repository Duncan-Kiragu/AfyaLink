import { Router, type Request, type Response } from "express";
import { ussdProviderRequestSchema } from "@kkd/contracts";
import { ussdDedupeKey } from "@kkd/integrations/ussd";
import { createLogger } from "@kkd/observability";
import { requireChannelSignature } from "../../middleware/channel-signature.js";
import { getEnv, requireUssdEnabled } from "../../services/context.js";
import { handleUssdCallback, ussdFailureResponse } from "../../services/channels/ussd-handler.js";
import { createUssdSummaryDelivery } from "../../services/channels/summary-delivery.js";

/**
 * USSD aggregator callback (Africa's Talking shape).
 *
 * Answers `text/plain` with a `CON `/`END ` prefixed body. Three things matter
 * here beyond the state machine itself:
 *
 *  - the aggregator retries slow callbacks, so the response is memoised per
 *    keypress and replayed verbatim (spec §11.5);
 *  - a failure returns a *terminal* safe screen rather than a 500, because an
 *    aggregator error page is not something a caller can act on (spec §20);
 *  - the raw body is never logged; it contains the caller's phone number.
 */

const log = createLogger("api.ussd");

export const ussdRouter = Router();

const signature = requireChannelSignature(() => getEnv().USSD_CALLBACK_SECRET);

ussdRouter.post("/", signature, async (req: Request, res: Response) => {
  const context = requireUssdEnabled();

  const parsed = ussdProviderRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn({ event: "ussd_invalid_callback" }, "rejected malformed USSD callback");
    const failure = ussdFailureResponse("en");
    res.status(200).type("text/plain").send(failure.body);
    return;
  }

  const request = parsed.data;
  const dedupeKey = ussdDedupeKey(request);
  const claim = await context.idempotency.claim("ussd", dedupeKey);

  // A retry must replay the previous screen. Serving the *next* screen would
  // advance the caller past a question they never answered.
  if (claim.status === "replay") {
    res.status(200).type("text/plain").send(claim.response);
    return;
  }
  if (claim.status === "in_flight") {
    // Still being processed. Ending safely beats a duplicate advance.
    const failure = ussdFailureResponse("en");
    res.status(200).type("text/plain").send(failure.body);
    return;
  }

  try {
    const result = await handleUssdCallback(request, {
      engine: context.engine,
      channelSessions: context.channelSessions,
      hasher: context.hasher,
      ttlSeconds: context.env.USSD_SESSION_TTL_SECONDS,
      // The phone number stays in this request's scope only; the delivery
      // helper derives a WhatsApp pseudonym from it and never persists it.
      summaryDelivery: createUssdSummaryDelivery({
        redis: context.redis,
        engine: context.engine,
        channelSessions: context.channelSessions,
        hasher: context.hasher,
        phoneNumber: request.phoneNumber,
      }),
    });

    await context.idempotency.complete("ussd", dedupeKey, result.body);

    log.info(
      {
        event: result.telemetry.event,
        channel: "ussd",
        sessionMode: "anonymous_ephemeral",
        language: result.telemetry.language,
        status: result.telemetry.step,
      },
      "ussd screen served",
    );

    res.status(200).type("text/plain").send(result.body);
  } catch (error) {
    await context.idempotency.release("ussd", dedupeKey);
    log.error(
      { event: "ussd_handler_failed", channel: "ussd" },
      "USSD callback failed; returning safe terminal screen",
    );
    void error;
    const failure = ussdFailureResponse("en");
    res.status(200).type("text/plain").send(failure.body);
  }
});

ussdRouter.get("/health", (_req: Request, res: Response) => {
  const env = getEnv();
  res.status(200).json({
    enabled: env.FEATURE_USSD,
    provider: env.USSD_PROVIDER,
    configured: Boolean(env.USSD_CALLBACK_SECRET && env.CHANNEL_IDENTITY_SALT),
  });
});
