import { Router, type Request } from "express";
import {
  computeScoreInputSchema,
  createRecordInputSchema,
  exportJobParamsSchema,
  exportRecordInputSchema,
  grantConsentInputSchema,
  healthRecordListSchema,
  persistFactsInputSchema,
  persistFactsResultSchema,
  recordEntryInputSchema,
  recordEntryListSchema,
  recordExportBundleSchema,
  recordFiltersSchema,
  recordIdParamsSchema,
  scoreListSchema,
  scoreSnapshotResponseSchema,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { httpError } from "../../lib/http-error.js";
import {
  appendEntry,
  computeAndStoreScore,
  consentStatus,
  createRecord,
  deleteAllRecords,
  deleteRecord,
  exportRecord,
  getRecord,
  grantConsent,
  listEntries,
  listRecords,
  listScores,
  persistSelectedFacts,
  readExport,
  withdrawConsent,
} from "./records.service.js";

export const recordsRouter = Router();

recordsRouter.use((_req, res, next) => {
  const env = loadEnv();
  if (!env.FEATURE_HEALTH_RECORDS) {
    res.status(404).json({ error: "health_records_disabled" });
    return;
  }
  next();
});

function userId(req: Request): string {
  if (!req.auth?.userId) {
    throw httpError("unauthenticated", 401);
  }
  return req.auth.userId;
}

recordsRouter.use(requireAuth);

recordsRouter.get("/consent", async (req, res, next) => {
  try {
    res.json(await consentStatus(userId(req)));
  } catch (error) {
    next(error);
  }
});

recordsRouter.post("/consent", validate(grantConsentInputSchema), async (req, res, next) => {
  try {
    const body = grantConsentInputSchema.parse(req.body);
    res.status(201).json(await grantConsent(userId(req), body.version));
  } catch (error) {
    next(error);
  }
});

recordsRouter.delete("/consent", async (req, res, next) => {
  try {
    res.json(await withdrawConsent(userId(req)));
  } catch (error) {
    next(error);
  }
});

recordsRouter.get("/exports/:jobId", validate(exportJobParamsSchema, "params"), async (req, res, next) => {
  try {
    const params = exportJobParamsSchema.parse(req.params);
    const exp = typeof req.query.exp === "string" ? req.query.exp : undefined;
    const sig = typeof req.query.sig === "string" ? req.query.sig : undefined;
    const bundle = await readExport(userId(req), params.jobId, exp, sig);
    res.json(recordExportBundleSchema.parse(bundle));
  } catch (error) {
    next(error);
  }
});

recordsRouter.get("/", async (req, res, next) => {
  try {
    res.json(healthRecordListSchema.parse({ records: await listRecords(userId(req)) }));
  } catch (error) {
    next(error);
  }
});

recordsRouter.post("/", validate(createRecordInputSchema), async (req, res, next) => {
  try {
    const body = createRecordInputSchema.parse(req.body);
    const record = await createRecord(userId(req), body);
    res.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

recordsRouter.delete("/", async (req, res, next) => {
  try {
    const deleted = await deleteAllRecords(userId(req));
    res.json({ deleted });
  } catch (error) {
    next(error);
  }
});

recordsRouter.get("/:id", validate(recordIdParamsSchema, "params"), async (req, res, next) => {
  try {
    const params = recordIdParamsSchema.parse(req.params);
    res.json({ record: await getRecord(userId(req), params.id) });
  } catch (error) {
    next(error);
  }
});

recordsRouter.delete("/:id", validate(recordIdParamsSchema, "params"), async (req, res, next) => {
  try {
    const params = recordIdParamsSchema.parse(req.params);
    await deleteRecord(userId(req), params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

recordsRouter.get(
  "/:id/entries",
  validate(recordIdParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const params = recordIdParamsSchema.parse(req.params);
      const filters = recordFiltersSchema.parse(req.query);
      res.json(
        recordEntryListSchema.parse({
          entries: await listEntries(userId(req), params.id, filters),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

recordsRouter.post(
  "/:id/entries",
  validate(recordIdParamsSchema, "params"),
  validate(recordEntryInputSchema),
  async (req, res, next) => {
    try {
      const params = recordIdParamsSchema.parse(req.params);
      const body = recordEntryInputSchema.parse(req.body);
      const entry = await appendEntry(userId(req), params.id, body);
      res.status(201).json(entry);
    } catch (error) {
      next(error);
    }
  },
);

recordsRouter.post(
  "/:id/persist",
  validate(recordIdParamsSchema, "params"),
  validate(persistFactsInputSchema),
  async (req, res, next) => {
    try {
      const params = recordIdParamsSchema.parse(req.params);
      const body = persistFactsInputSchema.parse(req.body);
      const result = await persistSelectedFacts(userId(req), params.id, body);
      res.status(201).json(persistFactsResultSchema.parse(result));
    } catch (error) {
      next(error);
    }
  },
);

recordsRouter.get(
  "/:id/scores",
  validate(recordIdParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const params = recordIdParamsSchema.parse(req.params);
      res.json(scoreListSchema.parse({ scores: await listScores(userId(req), params.id) }));
    } catch (error) {
      next(error);
    }
  },
);

recordsRouter.post(
  "/:id/scores",
  validate(recordIdParamsSchema, "params"),
  validate(computeScoreInputSchema),
  async (req, res, next) => {
    try {
      const params = recordIdParamsSchema.parse(req.params);
      const body = computeScoreInputSchema.parse(req.body);
      const score = await computeAndStoreScore(userId(req), params.id, body);
      res.status(201).json(scoreSnapshotResponseSchema.parse({ score }));
    } catch (error) {
      next(error);
    }
  },
);

recordsRouter.post(
  "/:id/export",
  validate(recordIdParamsSchema, "params"),
  validate(exportRecordInputSchema),
  async (req, res, next) => {
    try {
      const params = recordIdParamsSchema.parse(req.params);
      const body = exportRecordInputSchema.parse(req.body);
      const job = await exportRecord(userId(req), params.id, body.format);
      res.status(201).json({ job });
    } catch (error) {
      next(error);
    }
  },
);
