import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "@kkd/config";

export function createServiceRoleClient(): SupabaseClient | undefined {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return undefined;
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function userIdFromAccessToken(token: string): Promise<string | undefined> {
  const env = loadEnv();
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) {
    return undefined;
  }
  const client = createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) {
    return undefined;
  }
  return data.user.id;
}
