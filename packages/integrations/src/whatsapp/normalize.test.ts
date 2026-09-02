import { describe, expect, it } from "vitest";
import type { WAMessage } from "baileys";
import {
  extractWhatsAppText,
  isIgnorableWhatsAppJid,
  shouldProcessWhatsAppMessage,
  WHATSAPP_MAX_INBOUND_CHARS,
} from "./normalize.js";

function waMessage(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: { remoteJid: "254712345678@s.whatsapp.net", id: "MSG1", fromMe: false },
    messageTimestamp: 1_800_000_000,
    ...overrides,
  } as WAMessage;
}

describe("extractWhatsAppText", () => {
  it("reads a plain conversation message", () => {
    const result = extractWhatsAppText(waMessage({ message: { conversation: "chest pain" } }));
    expect(result).toEqual({ text: "chest pain" });
  });

  it("reads an extended text message", () => {
    const result = extractWhatsAppText(
      waMessage({ message: { extendedTextMessage: { text: "  since yesterday  " } } }),
    );
    expect(result).toEqual({ text: "since yesterday" });
  });

  it("unwraps an ephemeral envelope", () => {
    const result = extractWhatsAppText(
      waMessage({ message: { ephemeralMessage: { message: { conversation: "fever" } } } }),
    );
    expect(result).toEqual({ text: "fever" });
  });

  it("unwraps a view-once envelope", () => {
    const result = extractWhatsAppText(
      waMessage({ message: { viewOnceMessageV2: { message: { conversation: "headache" } } } }),
    );
    expect(result).toEqual({ text: "headache" });
  });

  it("reads a native button reply id when WhatsApp happens to deliver one", () => {
    const result = extractWhatsAppText(
      waMessage({
        message: { buttonsResponseMessage: { selectedButtonId: "yes" } },
      }),
    );
    expect(result).toEqual({ text: "yes" });
  });

  it("refuses an image instead of forwarding it anywhere", () => {
    const result = extractWhatsAppText(
      waMessage({ message: { imageMessage: { mimetype: "image/jpeg" } } }),
    );
    expect(result).toEqual({ rejection: "unsupported_media" });
  });

  it("refuses a voice note", () => {
    const result = extractWhatsAppText(
      waMessage({ message: { audioMessage: { ptt: true, mimetype: "audio/ogg" } } }),
    );
    expect(result).toEqual({ rejection: "unsupported_media" });
  });

  it("refuses a document, a location, and a shared contact", () => {
    for (const message of [
      { documentMessage: { fileName: "labs.pdf" } },
      { locationMessage: { degreesLatitude: -1.28, degreesLongitude: 36.81 } },
      { contactMessage: { displayName: "Dr Kamau" } },
    ]) {
      expect(extractWhatsAppText(waMessage({ message }))).toEqual({
        rejection: "unsupported_media",
      });
    }
  });

  it("prefers a caption over refusing a document-with-caption", () => {
    const result = extractWhatsAppText(
      waMessage({
        message: {
          documentWithCaptionMessage: {
            message: { extendedTextMessage: { text: "my results" } },
          },
        },
      }),
    );
    expect(result).toEqual({ text: "my results" });
  });

  it("rejects a message longer than the channel budget", () => {
    const result = extractWhatsAppText(
      waMessage({ message: { conversation: "a".repeat(WHATSAPP_MAX_INBOUND_CHARS + 1) } }),
    );
    expect(result).toEqual({ rejection: "too_long" });
  });

  it("rejects an empty or contentless message", () => {
    expect(extractWhatsAppText(waMessage({ message: { conversation: "   " } }))).toEqual({
      rejection: "empty_message",
    });
    expect(extractWhatsAppText(waMessage({ message: null }))).toEqual({
      rejection: "empty_message",
    });
  });
});

describe("shouldProcessWhatsAppMessage", () => {
  it("ignores our own outbound messages", () => {
    expect(
      shouldProcessWhatsAppMessage(
        waMessage({
          key: { remoteJid: "254712345678@s.whatsapp.net", id: "M", fromMe: true },
        }),
      ),
    ).toBe(false);
  });

  it("never answers into a group, broadcast, status, or newsletter", () => {
    for (const jid of [
      "1234-5678@g.us",
      "status@broadcast",
      "1234@broadcast",
      "123@newsletter",
    ]) {
      expect(isIgnorableWhatsAppJid(jid)).toBe(true);
      expect(
        shouldProcessWhatsAppMessage(waMessage({ key: { remoteJid: jid, id: "M", fromMe: false } })),
      ).toBe(false);
    }
  });

  it("processes a one-to-one message", () => {
    expect(shouldProcessWhatsAppMessage(waMessage({ message: { conversation: "hi" } }))).toBe(true);
  });

  it("ignores a message with no JID", () => {
    expect(isIgnorableWhatsAppJid(undefined)).toBe(true);
  });
});
