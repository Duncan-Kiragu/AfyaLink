import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { createLogger } from "@kkd/observability";
import { NotImplementedError } from "../lib/not-implemented.js";

const log = createLogger("api.errors");

/** Errors that carry a safe HTTP status and a stable machine-readable code. */
const STATUS_BY_ERROR_NAME: Record<string, { status: number; code: string }> = {
  SessionNotFoundError: { status: 404, code: "session_not_found" },
  DisclosureRequiredError: { status: 428, code: "disclosure_required" },
  ChannelsDisabledError: { status: 404, code: "channel_disabled" },
  ChannelMisconfiguredError: { status: 503, code: "channel_unavailable" },
  RedisUnavailableError: { status: 503, code: "service_unavailable" },
  ChannelIdentityKeyMissingError: { status: 503, code: "channel_unavailable" },
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.getHeader("x-request-id");

  if (err instanceof NotImplementedError) {
    res.status(501).json({ error: "not_implemented", requestId });
    return;
  }

  if (err instanceof ZodError) {
    // The validation issues can quote patient text, so only the shape of the
    // failure is returned and nothing is logged (spec §18).
    res.status(400).json({ error: "invalid_request", requestId });
    return;
  }

  const mapped = err instanceof Error ? STATUS_BY_ERROR_NAME[err.name] : undefined;
  if (mapped) {
    log.warn(
      { requestId: String(requestId ?? ""), event: err instanceof Error ? err.name : "error" },
      "handled_error",
    );
    res.status(mapped.status).json({ error: mapped.code, requestId });
    return;
  }

  // Path only — never the body, query string, or error message.
  log.error({ requestId: String(requestId ?? ""), status: req.path }, "unhandled_error");
  res.status(500).json({ error: "internal_error", requestId });
}
