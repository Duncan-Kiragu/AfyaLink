import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  CHANNEL_SIGNATURE_HEADER,
  CHANNEL_TIMESTAMP_HEADER,
  verifyChannelSignature,
} from "@kkd/integrations/channel";
import { createLogger } from "@kkd/observability";

/**
 * HMAC verification for channel callbacks (spec §11.5, §17).
 *
 * A rejection logs the reason code only — never the body, headers, or query
 * string, any of which can carry a phone number or symptom text (spec §18).
 */

const log = createLogger("api.channels.signature");

/**
 * The raw request bytes, stashed by the body-parser `verify` hook.
 *
 * Signatures must be checked against exactly what arrived, not against a
 * re-serialization of the parsed body — key order and number formatting would
 * differ and every signature would fail.
 */
export interface RawBodyRequest extends Request {
  rawBody?: string;
}

/** Body parser `verify` hook: keeps the raw bytes for HMAC checking. */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = buf.toString("utf8");
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function requireChannelSignature(
  secretFor: (req: Request) => string | undefined,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const secret = secretFor(req);
    if (!secret) {
      // Refusing is the only safe option: accepting unsigned clinical traffic
      // would be worse than the channel being unavailable.
      log.error({ event: "channel_signature_unconfigured" }, "no signing secret configured");
      res.status(503).json({ error: "channel_unavailable" });
      return;
    }

    const verification = verifyChannelSignature({
      secret,
      rawBody: (req as RawBodyRequest).rawBody ?? "",
      signature: headerValue(req, CHANNEL_SIGNATURE_HEADER),
      timestamp: headerValue(req, CHANNEL_TIMESTAMP_HEADER),
    });

    if (!verification.valid) {
      log.warn(
        { event: "channel_signature_rejected", status: verification.reason },
        "rejected channel callback",
      );
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    next();
  };
}
