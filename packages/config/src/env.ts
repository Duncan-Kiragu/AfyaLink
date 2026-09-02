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
  PRESIDIO_ANALYZER_URL: z.string().optional(),
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
  FEATURE_HEALTH_RECORDS: featureFlagSchema,
  FEATURE_HEALTH_PROFILE: featureFlagSchema,
  FEATURE_WHATSAPP: featureFlagSchema,
  FEATURE_USSD: featureFlagSchema,
  FEATURE_VOICE: featureFlagSchema,
  FEATURE_MCP: featureFlagSchema,
});

const productionRequired = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "PRESIDIO_ANALYZER_URL",
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
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
