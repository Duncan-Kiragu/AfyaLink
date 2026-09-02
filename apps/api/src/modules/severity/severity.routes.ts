import { Router, type Response } from "express";
import { safetyAssessmentSchema, severityEvaluationInputSchema } from "@kkd/contracts";
import { validate } from "../../middleware/validate.js";
import { emitSeverityTelemetry, evaluateSeverityRequest } from "./severity.service.js";

export const severityRouter = Router();

function requestIdOf(res: Response): string | undefined {
  const header = res.getHeader("x-request-id");
  return typeof header === "string" ? header : undefined;
}

/**
 * `POST /api/v1/severity/evaluate` (spec §19).
 *
 * Stateless form: the body is a `SeverityEvaluationInput` — normalized facts, not a
 * session. Session-backed evaluation waits on Evans's session service and is a later
 * slice; the engine itself is session-free by design (spec §8.4.E re-runs it for
 * check-ins, which have no session).
 *
 * Anonymous by design: no `requireAuth`. Urgency evaluation must work in anonymous
 * clinic mode, and nothing here is persisted.
 *
 * Middleware order per `docs/architecture/conventions.md`. Steps 1-6 (request-id,
 * security headers, CORS, body-size limit, auth, rate limit) are applied app-wide in
 * `app.ts`; this route adds 7 (request schema validation), 8 (handler/service),
 * 9 (response schema validation) and 10 (privacy-safe telemetry).
 */
severityRouter.post(
  "/evaluate",
  validate(severityEvaluationInputSchema),
  (req, res, next) => {
    try {
      const input = severityEvaluationInputSchema.parse(req.body);
      const requestId = requestIdOf(res);
      const assessment = evaluateSeverityRequest(input, requestId);
      const body = safetyAssessmentSchema.parse(assessment);
      res.status(200).json(body);
      emitSeverityTelemetry(body, requestId);
    } catch (error) {
      next(error);
    }
  },
);
