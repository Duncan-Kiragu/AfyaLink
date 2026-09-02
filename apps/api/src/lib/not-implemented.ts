import type { Request, Response } from "express";

export class NotImplementedError extends Error {
  readonly statusCode = 501;

  constructor(feature: string) {
    super(`${feature} is not implemented`);
    this.name = "NotImplementedError";
  }
}

export function sendNotImplemented(res: Response, feature: string): void {
  res.status(501).json({ error: "not_implemented", feature });
}

export function notImplementedHandler(feature: string) {
  return (_req: Request, res: Response): void => {
    sendNotImplemented(res, feature);
  };
}
