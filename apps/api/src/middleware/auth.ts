import type { NextFunction, Request, Response } from "express";
import { loadEnv } from "@kkd/config";
import { userIdFromAccessToken } from "../lib/supabase.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

export async function resolveAuth(req: Request): Promise<{ userId: string } | undefined> {
  const env = loadEnv();
  const allowDevHeader =
    env.NODE_ENV === "test" || env.NODE_ENV === "development" || env.APP_ENV === "local";
  if (allowDevHeader) {
    const testUser = req.header("x-kkd-user-id");
    if (testUser && UUID_RE.test(testUser)) {
      return { userId: testUser };
    }
  }
  const token = bearerToken(req);
  if (!token) {
    return undefined;
  }
  const userId = await userIdFromAccessToken(token);
  if (!userId) {
    return undefined;
  }
  return { userId };
}

export async function auth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.auth = await resolveAuth(req);
    next();
  } catch {
    next();
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resolved = req.auth ?? (await resolveAuth(req));
    if (!resolved?.userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.auth = resolved;
    next();
  } catch (error) {
    next(error);
  }
}
