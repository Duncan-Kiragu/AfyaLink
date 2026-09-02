import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "@kkd/config";

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../.env");
loadDotenv({ path: rootEnv });

const shouldRun = process.env.RUN_SUPABASE_RLS === "1";

type CreatedUser = { id: string; email: string; password: string };

describe.skipIf(!shouldRun)("live Supabase RLS for health_records", () => {
  let admin: SupabaseClient;
  let userA: CreatedUser;
  let userB: CreatedUser;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let recordId: string | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("SUPABASE_URL, service-role/secret key, and publishable key are required");
    }
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    userA = await createUser(admin, "a");
    userB = await createUser(admin, "b");
    clientA = await signIn(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, userA);
    clientB = await signIn(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, userB);
  }, 60_000);

  afterAll(async () => {
    if (recordId && admin) {
      await admin.from("health_records").delete().eq("id", recordId);
    }
    if (admin && userA) {
      await admin.auth.admin.deleteUser(userA.id);
    }
    if (admin && userB) {
      await admin.auth.admin.deleteUser(userB.id);
    }
  }, 60_000);

  it("lets user A insert a row and hides it from user B", async () => {
    const inserted = await clientA
      .from("health_records")
      .insert({ user_id: userA.id, label: "kkd-rls-isolation" })
      .select("id")
      .single();
    if (inserted.error) {
      throw new Error(
        `Insert failed. If the health_records migration is not applied, apply supabase/migrations/20260902120000_health_records.sql. ${inserted.error.message}`,
      );
    }
    recordId = inserted.data.id as string;

    const own = await clientA.from("health_records").select("id").eq("id", recordId).maybeSingle();
    expect(own.data?.id).toBe(recordId);

    const peek = await clientB.from("health_records").select("id").eq("id", recordId).maybeSingle();
    expect(peek.error).toBeNull();
    expect(peek.data).toBeNull();

    const spoof = await clientB.from("health_records").insert({
      user_id: userA.id,
      label: "should-not-insert",
    });
    expect(spoof.error).toBeTruthy();

    const removed = await clientB.from("health_records").delete().eq("id", recordId).select("id");
    expect(removed.data ?? []).toEqual([]);
  });
});

async function createUser(admin: SupabaseClient, suffix: string): Promise<CreatedUser> {
  const email = `kkd-rls-${suffix}-${Date.now()}@invalid.kkd.test`;
  const password = `Rls-${crypto.randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "createUser failed");
  }
  return { id: created.data.user.id, email, password };
}

async function signIn(
  url: string,
  publishableKey: string,
  user: CreatedUser,
): Promise<SupabaseClient> {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (session.error || !session.data.session) {
    throw new Error(session.error?.message ?? "signIn failed");
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` } },
  });
}
