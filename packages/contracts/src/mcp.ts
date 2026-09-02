import { z } from "zod";

export const MCP_TOOL_NAMES = [
  "kkd.start_session",
  "kkd.submit_patient_message",
  "kkd.get_next_question",
  "kkd.get_session_summary",
  "kkd.evaluate_urgency",
  "kkd.search_nearby_care",
  "kkd.close_session",
  "kkd.save_selected_facts_to_profile",
  "kkd.create_followup_schedule",
  "kkd.request_human_callback",
] as const;

export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof mcpToolNameSchema>;

export const MCP_SCOPES = [
  "session:create",
  "session:write",
  "session:read_summary",
  "safety:evaluate",
  "providers:search",
  "profile:write",
  "followup:create",
  "voice:callback",
] as const;

export const mcpScopeSchema = z.enum(MCP_SCOPES);
export type McpScope = z.infer<typeof mcpScopeSchema>;
