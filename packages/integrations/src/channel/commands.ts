/**
 * Deterministic keyword commands available on text channels. These are parsed
 * before any AI call so that language switching, restarting, and closing a
 * session never depend on the model being reachable (spec §20).
 */
export const channelCommandSchemaValues = [
  "start",
  "language",
  "close",
  "summary",
  "help",
] as const;
export type ChannelCommand = (typeof channelCommandSchemaValues)[number];

const COMMAND_KEYWORDS: Record<ChannelCommand, readonly string[]> = {
  start: ["hi", "hello", "start", "menu", "habari", "mambo", "anza"],
  language: ["lang", "language", "lugha"],
  close: ["close", "end", "stop", "delete", "funga", "maliza"],
  summary: ["summary", "muhtasari"],
  help: ["help", "msaada"],
};

/**
 * Returns a command only for an exact single-keyword message. A patient writing
 * "I need help, my chest hurts" must reach the clinical path, not the help
 * screen, so substring matching is deliberately avoided.
 */
export function parseChannelCommand(text: string | undefined): ChannelCommand | undefined {
  if (!text) return undefined;
  const normalized = text.trim().toLowerCase().replace(/[!.?]+$/, "");
  if (normalized.length === 0 || normalized.includes(" ")) return undefined;
  for (const command of channelCommandSchemaValues) {
    if (COMMAND_KEYWORDS[command].includes(normalized)) return command;
  }
  return undefined;
}
