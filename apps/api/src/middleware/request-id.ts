import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.header("x-request-id") ?? randomUUID();
  res.setHeader("x-request-id", id);
  next();
}
