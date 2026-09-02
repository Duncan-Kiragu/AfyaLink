import type { SessionPlaceholderStore } from "./types.js";

export class InMemorySessionPlaceholderStore implements SessionPlaceholderStore {
  private readonly maps = new Map<string, Record<string, string>>();

  async load(sessionId: string): Promise<Record<string, string>> {
    return { ...(this.maps.get(sessionId) ?? {}) };
  }

  async save(sessionId: string, map: Record<string, string>): Promise<void> {
    this.maps.set(sessionId, { ...map });
  }

  async clear(sessionId: string): Promise<void> {
    this.maps.delete(sessionId);
  }
}
