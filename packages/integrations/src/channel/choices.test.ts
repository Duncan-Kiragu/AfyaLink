import { describe, expect, it } from "vitest";
import type { ConversationChoice } from "@kkd/contracts";
import { CHOICE_SYNONYMS, renderChoices, renderOutboundBody, resolveChoiceReply } from "./choices.js";
import { parseChannelCommand } from "./commands.js";

const yesNo: ConversationChoice[] = [
  { id: "yes", label: "Yes", synonyms: [...CHOICE_SYNONYMS.yes] },
  { id: "no", label: "No", synonyms: [...CHOICE_SYNONYMS.no] },
];

describe("renderChoices", () => {
  it("numbers choices from 1 and maps the number back to the id", () => {
    const rendered = renderChoices(yesNo, (choice) => choice.label ?? choice.id);
    expect(rendered.lines).toEqual(["1. Yes", "2. No"]);
    expect(rendered.byNumber).toEqual({ "1": "yes", "2": "no" });
  });
});

describe("resolveChoiceReply", () => {
  it("resolves the displayed number", () => {
    expect(resolveChoiceReply("2", yesNo)).toEqual({ choiceId: "no" });
  });

  it("tolerates trailing punctuation and whitespace", () => {
    expect(resolveChoiceReply(" 1. ", yesNo)).toEqual({ choiceId: "yes" });
  });

  it("resolves the English label", () => {
    expect(resolveChoiceReply("yes", yesNo)).toEqual({ choiceId: "yes" });
  });

  it("resolves a Kiswahili synonym", () => {
    expect(resolveChoiceReply("Ndiyo", yesNo)).toEqual({ choiceId: "yes" });
    expect(resolveChoiceReply("hapana", yesNo)).toEqual({ choiceId: "no" });
  });

  it("resolves a localized label supplied at render time", () => {
    expect(resolveChoiceReply("Sina hakika", [
      { id: "unsure", labelKey: "channel.choice.unsure", synonyms: [] },
    ], { unsure: "Sina hakika" })).toEqual({ choiceId: "unsure" });
  });

  it("falls back to free text rather than guessing a choice", () => {
    expect(resolveChoiceReply("my chest hurts", yesNo)).toEqual({ text: "my chest hurts" });
  });

  it("does not select a choice from an out-of-range number", () => {
    expect(resolveChoiceReply("9", yesNo)).toEqual({ text: "9" });
  });

  it("returns nothing for an empty reply", () => {
    expect(resolveChoiceReply("   ", yesNo)).toEqual({});
  });
});

describe("renderOutboundBody", () => {
  it("appends a numbered menu, because Baileys cannot send native buttons", () => {
    const body = renderOutboundBody({
      channel: "whatsapp",
      channelUserHash: "hash",
      text: "Has it got worse?",
      choices: yesNo,
      choiceLabels: { yes: "Ndiyo", no: "Hapana" },
      locale: "sw",
      urgent: false,
      terminal: false,
    });
    expect(body).toBe("Has it got worse?\n\n1. Ndiyo\n2. Hapana");
  });

  it("leaves a free-text prompt untouched", () => {
    const body = renderOutboundBody({
      channel: "whatsapp",
      channelUserHash: "hash",
      text: "What are you experiencing?",
      choices: [],
      choiceLabels: {},
      locale: "en",
      urgent: false,
      terminal: false,
    });
    expect(body).toBe("What are you experiencing?");
  });
});

describe("parseChannelCommand", () => {
  it("recognises single-keyword commands in both languages", () => {
    expect(parseChannelCommand("hi")).toBe("start");
    expect(parseChannelCommand("LANG")).toBe("language");
    expect(parseChannelCommand("lugha")).toBe("language");
    expect(parseChannelCommand("funga")).toBe("close");
  });

  it("does not hijack a clinical message that contains a keyword", () => {
    // The critical case: "help" inside a symptom description must reach the
    // clinical path, not the help screen.
    expect(parseChannelCommand("I need help, my chest hurts")).toBeUndefined();
    expect(parseChannelCommand("please stop the pain")).toBeUndefined();
  });

  it("ignores empty input", () => {
    expect(parseChannelCommand(undefined)).toBeUndefined();
    expect(parseChannelCommand("  ")).toBeUndefined();
  });
});
