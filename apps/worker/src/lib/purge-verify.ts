import { createServiceRoleClient } from "./supabase.js";

const DEPENDENT_TABLES = [
  "health_record_entries",
  "measurements",
  "reported_medications",
  "score_snapshots",
  "record_exports",
] as const;

export async function countRemainingRecordRows(recordId: string): Promise<number | undefined> {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    return undefined;
  }

  const recordCount = await supabase
    .from("health_records")
    .select("id", { count: "exact", head: true })
    .eq("id", recordId);
  if (recordCount.error) {
    throw new Error("purge_verify_query_failed");
  }

  let remaining = recordCount.count ?? 0;
  for (const table of DEPENDENT_TABLES) {
    const result = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId);
    if (result.error) {
      throw new Error("purge_verify_query_failed");
    }
    remaining += result.count ?? 0;
  }
  return remaining;
}
