import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "baileys";

/**
 * Baileys' bundled `useMultiFileAuthState` writes the WhatsApp account session
 * to local disk, which its own docs discourage for anything beyond a hobby bot.
 * Render instances have ephemeral filesystems, so a disk-backed session would
 * force a QR re-pair on every deploy. This stores the session in the shared
 * Redis instead, as a single hash per slot.
 *
 * These are *account credentials*, not clinical content: the hash carries no
 * TTL (a purge would log the number out) and is never written to Supabase or
 * logged. It must be treated as a secret at rest.
 */

/** Minimal hash operations, so this package stays free of a Redis dependency. */
export interface AuthHashStore {
  hget(key: string, fields: string[]): Promise<(string | null)[]>;
  hset(key: string, entries: Record<string, string>): Promise<void>;
  hdel(key: string, fields: string[]): Promise<void>;
  del(key: string): Promise<void>;
}

const CREDS_FIELD = "creds";

function keyField(type: string, id: string): string {
  return `key:${type}:${id}`;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize<T>(raw: string): T {
  return JSON.parse(raw, BufferJSON.reviver) as T;
}

/**
 * Serializes writes into a single chain. Baileys can issue overlapping `set`
 * calls during a handshake, and a half-applied credential write leaves an
 * unusable session that only a re-pair fixes.
 */
function createWriteQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export interface RedisAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Wipes the WhatsApp account session. Forces a fresh QR/pairing. */
  clearAll: () => Promise<void>;
  /** True when the slot already held credentials (no QR expected). */
  restored: boolean;
}

export async function useRedisAuthState(
  store: AuthHashStore,
  hashKey: string,
): Promise<RedisAuthState> {
  const [rawCreds] = await store.hget(hashKey, [CREDS_FIELD]);
  const restored = rawCreds !== null && rawCreds !== undefined;
  const creds: AuthenticationCreds = restored
    ? deserialize<AuthenticationCreds>(rawCreds)
    : initAuthCreds();

  const enqueue = createWriteQueue();

  const state: AuthenticationState = {
    creds,
    keys: {
      async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        if (ids.length === 0) return result;
        const values = await store.hget(
          hashKey,
          ids.map((id) => keyField(type, id)),
        );
        ids.forEach((id, index) => {
          const raw = values[index];
          if (raw === null || raw === undefined) return;
          const value = deserialize<SignalDataTypeMap[T]>(raw);
          // `app-state-sync-key` is the one type Baileys hands back to the
          // protobuf layer, so it must be rehydrated rather than left a plain
          // JSON clone (mirrors the reference `useMultiFileAuthState`).
          result[id] =
            type === "app-state-sync-key" && value
              ? (proto.Message.AppStateSyncKeyData.fromObject(
                  value as object,
                ) as unknown as SignalDataTypeMap[T])
              : value;
        });
        return result;
      },
      set(data: SignalDataSet) {
        const writes: Record<string, string> = {};
        const deletes: string[] = [];
        for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const entries = data[type];
          if (!entries) continue;
          for (const [id, value] of Object.entries(entries)) {
            const field = keyField(type, id);
            if (value === null || value === undefined) {
              deletes.push(field);
            } else {
              writes[field] = serialize(value);
            }
          }
        }
        // Signal key updates must be durable before the caller continues, or a
        // crash mid-handshake corrupts the session.
        return enqueue(async () => {
          if (Object.keys(writes).length > 0) await store.hset(hashKey, writes);
          if (deletes.length > 0) await store.hdel(hashKey, deletes);
        });
      },
    },
  };

  return {
    state,
    restored,
    saveCreds: () =>
      enqueue(async () => {
        await store.hset(hashKey, { [CREDS_FIELD]: serialize(state.creds) });
      }),
    clearAll: () => enqueue(() => store.del(hashKey)),
  };
}
