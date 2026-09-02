const STORAGE_KEY = "kkd-demo-user-id";

/** Stable demo identity for local `x-kkd-user-id` auth. Not a clinical transcript. */
export function getDemoUserId(): string {
  const fromEnv = import.meta.env.VITE_KKD_DEMO_USER_ID;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}
