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
  /**
   * Keyed salt for pseudonymous channel identities. Raw phone numbers and
   * provider session ids are never used as Redis keys or log fields; they are
   * HMAC'd with this salt first (spec §11.3B, §11.4A). Rotating it orphans
   * in-flight channel sessions, which is acceptable — they are ephemeral.
   */
  CHANNEL_IDENTITY_SALT: z.string().min(32).optional(),
  /** Sliding TTL for a channel's ephemeral session mapping. */
  CHANNEL_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),

  // --- WhatsApp -------------------------------------------------------------
  // V1 uses Baileys (WhatsApp Web multi-device protocol), not the Meta Cloud
  // API, so there is no phone-number id, access token, or webhook verify token.
  // The Cloud API variables below are kept only for a future migration and are
  // unused by the Baileys gateway.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** Shared HMAC secret for the gateway <-> API hop. */
  WHATSAPP_GATEWAY_SECRET: z.string().min(32).optional(),
  /** Redis slot holding the Baileys account session; one per environment. */
  WHATSAPP_AUTH_SLOT: z.string().default("default"),
  /** Operator display name presented to WhatsApp as the linked device. */
  WHATSAPP_DEVICE_NAME: z.string().default("KKD"),

  // --- USSD -----------------------------------------------------------------
  USSD_PROVIDER: z.enum(["africastalking"]).default("africastalking"),
  USSD_API_KEY: z.string().optional(),
  USSD_CALLBACK_SECRET: z.string().min(32).optional(),
  USSD_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(180),
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
] as const;

/**
 * Variables a feature cannot run safely without. Enabling the flag without the
 * secret must fail at boot rather than degrade into an unauthenticated channel.
 */
const featureRequired = {
  FEATURE_WHATSAPP: ["CHANNEL_IDENTITY_SALT", "WHATSAPP_GATEWAY_SECRET", "REDIS_URL"],
  FEATURE_USSD: ["CHANNEL_IDENTITY_SALT", "USSD_CALLBACK_SECRET", "REDIS_URL"],
} as const;

export const envSchema = baseSchema.superRefine((env, ctx) => {
  for (const [flag, keys] of Object.entries(featureRequired) as [
    keyof typeof featureRequired,
    readonly (keyof typeof env)[],
  ][]) {
    if (!env[flag]) continue;
    for (const key of keys) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when ${flag} is enabled`,
        });
      }
    }
  }

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
