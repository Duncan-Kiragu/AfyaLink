import { z } from "zod";

const featureFlagSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const appEnvSchema = z.enum(["local", "staging", "production"]);

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: appEnvSchema.default("local"),
  WEB_BASE_URL: z.string().default("http://localhost:5173"),
  API_BASE_URL: z.string().default("http://localhost:3000"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  EPHEMERAL_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  SESSION_MAX_LIFETIME_SECONDS: z.coerce.number().int().positive().default(14400),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  GEO_PROVIDER: z.string().optional(),
  GEO_API_KEY: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  USSD_PROVIDER: z.string().optional(),
  USSD_API_KEY: z.string().optional(),
  USSD_CALLBACK_SECRET: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),
  VOICE_PHONE_NUMBER_ID: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  RECORD_EXPORT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  RECORD_EXPORT_SIGNING_SECRET: z.string().optional(),
  FEATURE_HEALTH_RECORDS: featureFlagSchema,
  FEATURE_HEALTH_PROFILE: featureFlagSchema,
  FEATURE_WHATSAPP: featureFlagSchema,
  FEATURE_USSD: featureFlagSchema,
  FEATURE_VOICE: featureFlagSchema,
  FEATURE_MCP: featureFlagSchema,
  /**
   * Execute clinically unreviewed `draft` safety rules and complaint pathways
   * (spec §8.3.A). Off by default: with it off, only rules carrying a named clinical
   * reviewer run, and the shipped `red-flags@0.1.0-draft` set has none — so every
   * evaluation returns `unknown`.
   *
   * This is the single switch between the safe default and a working demo. It lives
   * here rather than at the call site so that "are unreviewed clinical rules deciding
   * what patients are told?" is answerable from configuration alone.
   *
   * Permitted in `local` and `staging` (the hackathon demo runs from staging). Refused
   * in `production` by the `superRefine` below — config load fails rather than the
   * request.
   */
  FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES: featureFlagSchema,
});

const productionRequired = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

export const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.APP_ENV === "local") {
    return;
  }
  for (const key of productionRequired) {
    if (!env[key]) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required when APP_ENV is ${env.APP_ENV}`,
      });
    }
  }
  if (env.FEATURE_HEALTH_RECORDS && !env.RECORD_EXPORT_SIGNING_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["RECORD_EXPORT_SIGNING_SECRET"],
      message: "RECORD_EXPORT_SIGNING_SECRET is required when FEATURE_HEALTH_RECORDS is true and APP_ENV is not local",
    });
  }
  // Unreviewed clinical rules may run for a demo, never for real patients. Staging is
  // allowed on purpose: the demo runs there. Production is refused at config load, so
  // the process will not start rather than serving unreviewed dispositions (spec §8.3.A).
  if (env.APP_ENV === "production" && env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES) {
    ctx.addIssue({
      code: "custom",
      path: ["FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES"],
      message:
        "FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES must be false when APP_ENV is production: it executes clinically unreviewed safety rules",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
