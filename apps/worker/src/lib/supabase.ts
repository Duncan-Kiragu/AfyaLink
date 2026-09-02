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
