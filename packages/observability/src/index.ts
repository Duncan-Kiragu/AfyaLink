import pino from "pino";

export const SAFE_EVENT_KEYS = [
  "event",
  "requestId",
  "sessionMode",
  "channel",
  "language",
  "urgency",
  "promptVersion",
  "model",
  "status",
  "latencyMs",
  "ruleId",
] as const;

export type SafeLogFields = Partial<
  Record<(typeof SAFE_EVENT_KEYS)[number], string | number | boolean>
>;

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.body",
        "res.body",
        "headers.authorization",
        "headers.cookie",
        "*.phone",
        "*.email",
        "*.transcript",
        "*.patientText",
      ],
      remove: true,
    },
  });
}

export function assertSafeEvent(fields: SafeLogFields): SafeLogFields {
  for (const key of Object.keys(fields)) {
    if (!SAFE_EVENT_KEYS.includes(key as (typeof SAFE_EVENT_KEYS)[number])) {
      delete fields[key as keyof SafeLogFields];
    }
  }
  return fields;
}
