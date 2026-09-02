import type { NextFunction, Request, Response } from "express";
import { createLogger } from "@kkd/observability";

const log = createLogger("api.http");

export function telemetry(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    log.info({
      event: "http_request",
      path: req.path,
      status: res.statusCode,
      latencyMs: Date.now() - started,
    });
  });
  next();
}
