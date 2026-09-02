import type { NextFunction, Request, Response } from "express";

export function auth(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
