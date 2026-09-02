import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { createLogger } from "@kkd/observability";
import { NotImplementedError } from "../lib/not-implemented.js";

const log = createLogger("api.errors");

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.getHeader("x-request-id");
  if (err instanceof NotImplementedError) {
    res.status(501).json({ error: "not_implemented", requestId });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_request", requestId });
    return;
  }
  if (err instanceof Error && "statusCode" in err && typeof err.statusCode === "number") {
    res.status(err.statusCode).json({ error: err.message, requestId });
    return;
  }
  log.error({ requestId, path: req.path }, "unhandled_error");
  res.status(500).json({ error: "internal_error", requestId });
}
