import { describe, expect, it } from "vitest";
import { envSchema, loadEnv } from "./env.js";

/** The keys `productionRequired` demands once APP_ENV leaves `local`. */
const deployedBase = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  REDIS_URL: "redis://localhost:6379",
  ANTHROPIC_API_KEY: "key",
  ANTHROPIC_MODEL: "claude-model",
  PRESIDIO_ANALYZER_URL: "http://127.0.0.1:5002",
} as const;

describe("FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES", () => {
  it("defaults to off", () => {
    expect(loadEnv({}).FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES).toBe(false);
  });

  it("is refused in production, naming the flag", () => {
    const result = envSchema.safeParse({
      ...deployedBase,
      APP_ENV: "production",
      FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES: "true",
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((candidate) =>
      candidate.path.includes("FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES"),
    );
    expect(issue?.message).toContain("FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES");
    expect(issue?.message).toContain("clinically unreviewed");
  });

  it("is allowed in staging, where the demo runs", () => {
    const env = loadEnv({
      ...deployedBase,
      APP_ENV: "staging",
      FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES: "true",
    });

    expect(env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES).toBe(true);
  });

  it("is allowed in local", () => {
    const env = loadEnv({
      APP_ENV: "local",
      FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES: "true",
    });

    expect(env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES).toBe(true);
  });

  it("leaves production usable with the flag off", () => {
    const env = loadEnv({
      ...deployedBase,
      APP_ENV: "production",
      FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES: "false",
    });

    expect(env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES).toBe(false);
  });
});
