import { z } from "zod";

export const sessionModeSchema = z.enum(["anonymous_ephemeral", "patient_profile"]);
export type SessionMode = z.infer<typeof sessionModeSchema>;

export const channelSchema = z.enum(["web", "whatsapp", "ussd", "voice", "mcp"]);
export type Channel = z.infer<typeof channelSchema>;

export const localeSchema = z.string().min(2);
export type Locale = z.infer<typeof localeSchema>;
