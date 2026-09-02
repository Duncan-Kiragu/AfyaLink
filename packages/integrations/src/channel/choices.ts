import type { ConversationChoice, OutboundChannelMessage } from "@kkd/contracts";

/**
 * Channel-neutral choice rendering and resolution.
 *
 * WhatsApp over the multi-device web protocol (Baileys) cannot reliably deliver
 * native interactive buttons or list messages — those are a WhatsApp Business
 * Cloud API capability. So the safety-critical requirement behind spec §11.3D
 * ("use interactive controls for yes/no, severity, consent, language, next
 * action") is met with a deterministic numbered menu plus tolerant parsing of
 * the reply. USSD uses the same numbering natively.
 *
 * Numbering is 1-based and stable for the lifetime of a prompt, so a late reply
 * to a superseded prompt resolves against the prompt it was shown, not the
 * current one.
 */

export interface RenderedChoices {
  /** Lines to append to the message body, e.g. `1. Yes`. */
  lines: string[];
  /** Choice id keyed by the number shown to the patient. */
  byNumber: Record<string, string>;
}

export function renderChoices(
  choices: readonly ConversationChoice[],
  labelFor: (choice: ConversationChoice) => string,
): RenderedChoices {
  const lines: string[] = [];
  const byNumber: Record<string, string> = {};
  choices.forEach((choice, index) => {
    const number = String(index + 1);
    lines.push(`${number}. ${labelFor(choice)}`);
    byNumber[number] = choice.id;
  });
  return { lines, byNumber };
}

function normalizeReply(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[.)\s]+|[.)\s]+$/g, "");
}

export interface ChoiceResolution {
  choiceId?: string;
  /** Free text to pass through when the prompt also accepts prose. */
  text?: string;
}

/**
 * Resolves a patient reply against the choices they were shown. Accepts, in
 * order: the displayed number, the choice id, the rendered label, and any
 * locale synonyms the choice declares (so "ndiyo" selects the yes option).
 */
export function resolveChoiceReply(
  reply: string,
  choices: readonly ConversationChoice[],
  choiceLabels: Record<string, string> = {},
): ChoiceResolution {
  const normalized = normalizeReply(reply);
  if (normalized.length === 0) return {};

  if (/^\d+$/.test(normalized)) {
    const index = Number.parseInt(normalized, 10) - 1;
    const byNumber = choices[index];
    if (byNumber) return { choiceId: byNumber.id };
  }

  for (const choice of choices) {
    if (choice.id.toLowerCase() === normalized) return { choiceId: choice.id };
    const label = choiceLabels[choice.id];
    if (label && label.trim().toLowerCase() === normalized) return { choiceId: choice.id };
    if (choice.synonyms.some((synonym) => synonym.trim().toLowerCase() === normalized)) {
      return { choiceId: choice.id };
    }
  }

  return { text: reply.trim() };
}

/** Default synonym sets for the choices every channel reuses. */
export const CHOICE_SYNONYMS = {
  yes: ["yes", "y", "yeah", "yep", "ndiyo", "ndio", "naam", "sawa"],
  no: ["no", "n", "nope", "hapana", "la"],
  unsure: ["unsure", "not sure", "dunno", "sijui", "sina hakika"],
  continue: ["continue", "ok", "okay", "start", "endelea", "sawa"],
  exit: ["exit", "stop", "quit", "cancel", "toka", "acha"],
} as const;

/** Body text plus numbered choices, ready for a text-only transport. */
export function renderOutboundBody(message: OutboundChannelMessage): string {
  const rendered = renderChoices(
    message.choices,
    (choice) => message.choiceLabels[choice.id] ?? choice.label ?? choice.id,
  );
  if (rendered.lines.length === 0) return message.text;
  return `${message.text}\n\n${rendered.lines.join("\n")}`;
}
