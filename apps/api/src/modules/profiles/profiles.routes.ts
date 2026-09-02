import { Router, type Request, type Response } from "express";
import {
  createFollowUpScheduleInputSchema,
  dueCheckInListSchema,
  followUpScheduleListSchema,
  followUpScheduleSchema,
  grantProfileConsentInputSchema,
  profileConsentStatusSchema,
  scheduleIdParamsSchema,
  submitCheckInInputSchema,
  submitCheckInResultSchema,
  trendQuerySchema,
  trendReportSchema,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { httpError } from "../../lib/http-error.js";
import {
  createFollowUpSchedule,
  deleteFollowUpSchedule,
  grantProfileConsent,
  listDueCheckIns,
  listFollowUpSchedules,
  profileConsentStatus,
  submitCheckIn,
  trendReport,
  withdrawProfileConsent,
} from "./profiles.service.js";

/**
 * Health profiling endpoints (spec §8.4, §19).
 *
 * Middleware order per `docs/architecture/conventions.md`: steps 1-6 (request-id,
 * security headers, CORS, body-size limit, auth, rate limit) are applied app-wide in
 * `app.ts`; this router adds the feature gate, step 5's hard requirement (`requireAuth`
 * — profiling is never anonymous), 7 (request validation), 8 (handler/service), 9
 * (response validation) and 10 (privacy-safe telemetry, emitted in the service).
 */
export const profilesRouter = Router();

profilesRouter.use((_req, res, next) => {
  if (!loadEnv().FEATURE_HEALTH_PROFILE) {
    res.status(404).json({ error: "health_profile_disabled" });
    return;
  }
  next();
});

// Profiling is patient-owned, persistent data. There is no anonymous form of it
// (spec §8.7: "profile data exists only after explicit consent").
profilesRouter.use(requireAuth);

function userId(req: Request): string {
  if (!req.auth?.userId) {
    throw httpError("unauthenticated", 401);
  }
  return req.auth.userId;
}

/**
 * One clock reading per request.
 *
 * Taken here, at the edge, and threaded down. Everything below is then a pure function
 * of its arguments, and a single request cannot see two different "now"s partway
 * through deciding what is due.
 */
function now(): string {
  return new Date().toISOString();
}

function requestIdOf(res: Response): string | undefined {
  const header = res.getHeader("x-request-id");
  return typeof header === "string" ? header : undefined;
}

// --- Consent (spec §8.4.A) -------------------------------------------------

profilesRouter.get("/consent", async (req, res, next) => {
  try {
    res.json(profileConsentStatusSchema.parse(await profileConsentStatus(userId(req))));
  } catch (error) {
    next(error);
  }
});

profilesRouter.post(
  "/consent",
  validate(grantProfileConsentInputSchema),
  async (req, res, next) => {
    try {
      const body = grantProfileConsentInputSchema.parse(req.body);
      const status = await grantProfileConsent(userId(req), body.version, body.channel);
      res.status(201).json(profileConsentStatusSchema.parse(status));
    } catch (error) {
      next(error);
    }
  },
);

/** §8.4.A "allow withdrawal". Stops every future check-in in the same operation. */
profilesRouter.delete("/consent", async (req, res, next) => {
  try {
    res.json(profileConsentStatusSchema.parse(await withdrawProfileConsent(userId(req))));
  } catch (error) {
    next(error);
  }
});

// --- Schedules (spec §8.4.B) -----------------------------------------------

profilesRouter.get("/followups", async (req, res, next) => {
  try {
    res.json(
      followUpScheduleListSchema.parse({
        schedules: await listFollowUpSchedules(userId(req)),
      }),
    );
  } catch (error) {
    next(error);
  }
});

profilesRouter.post(
  "/followups",
  validate(createFollowUpScheduleInputSchema),
  async (req, res, next) => {
    try {
      const body = createFollowUpScheduleInputSchema.parse(req.body);
      const schedule = await createFollowUpSchedule(userId(req), body, now());
      res.status(201).json(followUpScheduleSchema.parse(schedule));
    } catch (error) {
      next(error);
    }
  },
);

profilesRouter.delete(
  "/followups/:id",
  validate(scheduleIdParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const params = scheduleIdParamsSchema.parse(req.params);
      await deleteFollowUpSchedule(userId(req), params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// --- Due check-ins (V1 delivery is in-app pull) ----------------------------

profilesRouter.get("/checkins/due", async (req, res, next) => {
  try {
    res.json(
      dueCheckInListSchema.parse({
        dueCheckIns: await listDueCheckIns(userId(req), now()),
      }),
    );
  } catch (error) {
    next(error);
  }
});

// --- Check-in intake, re-evaluation, trends (spec §8.4.C-E) ----------------

profilesRouter.post(
  "/followups/:id/checkins",
  validate(scheduleIdParamsSchema, "params"),
  validate(submitCheckInInputSchema),
  async (req, res, next) => {
    try {
      const params = scheduleIdParamsSchema.parse(req.params);
      const body = submitCheckInInputSchema.parse(req.body);
      const result = await submitCheckIn(userId(req), params.id, body, requestIdOf(res));
      res.status(201).json(submitCheckInResultSchema.parse(result));
    } catch (error) {
      next(error);
    }
  },
);

profilesRouter.get("/trends", async (req, res, next) => {
  try {
    const query = trendQuerySchema.parse(req.query);
    res.json(
      trendReportSchema.parse(await trendReport(userId(req), query.recordId, query.locale)),
    );
  } catch (error) {
    next(error);
  }
});
