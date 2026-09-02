import {
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  type WAMessage,
  type WAMessageContent,
} from "baileys";
import type { InboundRejection } from "@kkd/contracts";

/**
 * Extracts patient text from a Baileys message.
 *
 * V1 clinical media analysis is disabled (spec §11.3E). Media is recognised so
 * that we can answer with an approved "cannot review media" message — the
 * payload is never downloaded, decrypted, or forwarded to a third party.
 */

const MEDIA_CONTENT_TYPES = new Set<keyof WAMessageContent>([
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "documentWithCaptionMessage",
  "stickerMessage",
  "ptvMessage",
  "locationMessage",
  "liveLocationMessage",
  "contactMessage",
  "contactsArrayMessage",
]);

/** Longer than this is rejected before it reaches the AI or session store. */
export const WHATSAPP_MAX_INBOUND_CHARS = 1500;

export interface ExtractedWhatsAppText {
  text?: string;
  rejection?: InboundRejection;
}

/** Unwraps the ephemeral/view-once/edit envelopes WhatsApp nests content in. */
function unwrap(content: WAMessageContent | null | undefined): WAMessageContent | undefined {
  let current = content ?? undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const next =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      undefined;
    if (!next) return current;
    current = next;
  }
  return current;
}

export function extractWhatsAppText(message: WAMessage): ExtractedWhatsAppText {
  const content = unwrap(message.message);
  if (!content) return { rejection: "empty_message" };

  const contentType = getContentType(content);

  const raw =
    content.conversation ??
    content.extendedTextMessage?.text ??
    // Native interactive replies are accepted when WhatsApp happens to deliver
    // them, but nothing in KKD depends on them being available.
    content.buttonsResponseMessage?.selectedButtonId ??
    content.templateButtonReplyMessage?.selectedId ??
    content.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.name ??
    undefined;

  if (typeof raw === "string" && raw.trim().length > 0) {
    const trimmed = raw.trim();
    if (trimmed.length > WHATSAPP_MAX_INBOUND_CHARS) return { rejection: "too_long" };
    return { text: trimmed };
  }

  if (contentType && MEDIA_CONTENT_TYPES.has(contentType)) {
    return { rejection: "unsupported_media" };
  }

  return { rejection: "empty_message" };
}

/**
 * Conversations KKD must never answer: groups, status/broadcast lists, and
 * newsletters. A clinical interview only makes sense one-to-one, and replying
 * into a group would disclose a person's symptoms to third parties.
 */
export function isIgnorableWhatsAppJid(jid: string | undefined): boolean {
  if (!jid) return true;
  return Boolean(
    isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid) || isJidStatusBroadcast(jid),
  );
}

export function shouldProcessWhatsAppMessage(message: WAMessage): boolean {
  if (message.key.fromMe) return false;
  if (isIgnorableWhatsAppJid(message.key.remoteJid ?? undefined)) return false;
  // A `participant` on a one-to-one chat means the message arrived via a group
  // fan-out path; ignore rather than guess who the patient is.
  return true;
}
