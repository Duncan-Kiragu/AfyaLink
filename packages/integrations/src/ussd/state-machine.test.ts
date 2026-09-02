import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  USSD_MAX_BODY_CHARS,
  USSD_MAX_SCREENS,
  type ConversationTurn,
  type SafetyAssessment,
  type UssdSessionState,
} from "@kkd/contracts";
import { advanceUssdDialogue, renderDisclosureScreen, type UssdEngine } from "./state-machine.js";

/** A turn shaped like the shared engine's output, with only what we assert on. */
function turn(overrides: {
  urgency?: SafetyAssessment["urgency"];
  interrupt?: boolean;
  kind?: ConversationTurn["prompt"]["kind"];
  messageKey?: string;
  text?: string;
  choices?: ConversationTurn["prompt"]["choices"];
  locale?: string;
  safetyUnavailable?: boolean;
  targetFieldId?: string;
} = {}): ConversationTurn {
  return {
    session: {
      id: "session-1",
      mode: "anonymous_ephemeral",
      channel: "ussd",
      locale: overrides.locale ?? "en",
      createdAt: "2026-09-02T10:00:00.000Z",
      lastActivityAt: "2026-09-02T10:00:00.000Z",
      disclosureVersion: "1.0.0",
      facts: [],
      symptoms: [],
      safety: safety(overrides.urgency ?? "unknown"),
      completion: { percent: 0, missingFieldIds: [] },
    },
    safety: safety(overrides.urgency ?? "unknown"),
    prompt: {
      kind: overrides.kind ?? "question",
      inputKind: overrides.choices?.length ? "choice" : "free_text",
      choices: overrides.choices ?? [],
      interrupt: overrides.interrupt ?? false,
      ...(overrides.messageKey ? { messageKey: overrides.messageKey } : {}),
      ...(overrides.text ? { text: overrides.text } : {}),
      ...(overrides.targetFieldId ? { targetFieldId: overrides.targetFieldId } : {}),
    },
    degraded: {
      aiUnavailable: false,
      safetyEngineUnavailable: overrides.safetyUnavailable ?? false,
    },
  };
}

function safety(urgency: SafetyAssessment["urgency"]): SafetyAssessment {
  return {
    urgency,
    ruleIds: [],
    explanationKeys: [],
    missingCriticalFacts: [],
    requiresHumanEscalation: false,
    ruleSetVersion: "test.v1",
  };
}

function state(overrides: Partial<UssdSessionState> = {}): UssdSessionState {
  return {
    providerSessionIdHash: "psid-hash",
    channelUserHash: "user-hash",
    sessionId: "session-1",
    currentStep: "disclosure",
    locale: "en",
    disclosureVersion: "1.0.0",
    disclosureAcknowledged: false,
    pendingChoices: [],
    pendingChoiceLabels: {},
    screenCount: 0,
    createdAt: "2026-09-02T10:00:00.000Z",
    expiresAt: "2026-09-02T10:03:00.000Z",
    ...overrides,
  };
}

function engineStub(next: ConversationTurn = turn()): UssdEngine & {
  calls: { acknowledge: number; setLocale: string[]; submitted: unknown[]; closed: string[] };
} {
  const calls = { acknowledge: 0, setLocale: [] as string[], submitted: [] as unknown[], closed: [] as string[] };
  return {
    calls,
    acknowledgeDisclosure: vi.fn(async () => {
      calls.acknowledge += 1;
      return next;
    }),
    setLocale: vi.fn(async (_id: string, locale: string) => {
      calls.setLocale.push(locale);
      return next;
    }),
    submitPatientMessage: vi.fn(async (input) => {
      calls.submitted.push(input);
      return next;
    }),
    closeSession: vi.fn(async (id: string) => {
      calls.closed.push(id);
    }),
  };
}

describe("USSD disclosure screen", () => {
  it("states every required disclosure element and fits one screen", () => {
    const screen = renderDisclosureScreen();
    expect(screen.kind).toBe("continue");
    // §15: AI involved, does not diagnose, helps describe symptoms, not for
    // emergencies, temporary session.
    expect(screen.text).toMatch(/AI/);
    expect(screen.text).toMatch(/NOT diagnose/i);
    expect(screen.text).toMatch(/describe symptoms/i);
    expect(screen.text).toMatch(/emergenc/i);
    expect(screen.text).toMatch(/temporary/i);
    expect(screen.text.length).toBeLessThanOrEqual(USSD_MAX_BODY_CHARS);
  });

  it("is the very first screen, before any clinical question", async () => {
    const engine = engineStub();
    const result = await advanceUssdDialogue(state(), undefined, { engine });
    expect(result.response.text).toMatch(/NOT diagnose/i);
    expect(engine.calls.submitted).toHaveLength(0);
    expect(engine.calls.acknowledge).toBe(0);
  });
});

describe("USSD language selection", () => {
  it("acknowledges the disclosure and sets the locale when a language is picked", async () => {
    const engine = engineStub(turn({ messageKey: "pathway.generic.onset", locale: "sw" }));
    const first = await advanceUssdDialogue(state(), undefined, { engine });
    const second = await advanceUssdDialogue(first.state, "2", { engine });

    expect(engine.calls.setLocale).toEqual(["sw"]);
    expect(engine.calls.acknowledge).toBe(1);
    expect(second.state.disclosureAcknowledged).toBe(true);
    expect(second.state.locale).toBe("sw");
  });

  it("renders the next question in the chosen language", async () => {
    const engine = engineStub(turn({ messageKey: "pathway.generic.onset", locale: "sw" }));
    const first = await advanceUssdDialogue(state(), undefined, { engine });
    const second = await advanceUssdDialogue(first.state, "2", { engine });
    expect(second.response.text).toContain("Hii ilianza lini?");
  });

  it("re-shows the disclosure for an unrecognised keypress instead of guessing", async () => {
    const engine = engineStub();
    const first = await advanceUssdDialogue(state(), undefined, { engine });
    const second = await advanceUssdDialogue(first.state, "banana", { engine });
    expect(second.response.text).toMatch(/NOT diagnose/i);
    expect(engine.calls.acknowledge).toBe(0);
  });

  it("exits without acknowledging when the caller declines", async () => {
    const engine = engineStub();
    const first = await advanceUssdDialogue(state(), undefined, { engine });
    const second = await advanceUssdDialogue(first.state, "3", { engine });
    expect(second.response.kind).toBe("end");
    expect(engine.calls.acknowledge).toBe(0);
    expect(engine.calls.closed).toEqual(["session-1"]);
  });

  it("lets the caller change language mid-dialogue with 0", async () => {
    const engine = engineStub(turn({ messageKey: "pathway.generic.onset" }));
    const result = await advanceUssdDialogue(
      state({ currentStep: "conversation", disclosureAcknowledged: true }),
      "0",
      { engine },
    );
    expect(result.state.currentStep).toBe("language");
    expect(result.response.text).toContain("Choose a language");
    // Changing language must not submit "0" as a clinical answer.
    expect(engine.calls.submitted).toHaveLength(0);
  });
});

describe("USSD conversation screens", () => {
  const conversing = state({ currentStep: "conversation", disclosureAcknowledged: true });

  it("renders engine choices as a numbered menu and records them", async () => {
    const engine = engineStub(
      turn({
        messageKey: "pathway.generic.worsening",
        choices: [
          { id: "yes", labelKey: "channel.choice.yes", synonyms: [] },
          { id: "no", labelKey: "channel.choice.no", synonyms: [] },
        ],
        targetFieldId: "worsening",
      }),
    );
    const result = await advanceUssdDialogue(conversing, "1", { engine });

    expect(result.response.text).toContain("1. Yes");
    expect(result.response.text).toContain("2. No");
    expect(result.state.pendingChoices.map((choice) => choice.id)).toEqual(["yes", "no"]);
    expect(result.state.pendingFieldId).toBe("worsening");
  });

  it("resolves a keypress against what the previous screen displayed", async () => {
    const engine = engineStub(turn({ messageKey: "pathway.generic.onset" }));
    const withChoices = state({
      currentStep: "conversation",
      disclosureAcknowledged: true,
      pendingChoices: [
        { id: "yes", labelKey: "channel.choice.yes", synonyms: [] },
        { id: "no", labelKey: "channel.choice.no", synonyms: [] },
      ],
      pendingChoiceLabels: { yes: "Yes", no: "No" },
    });

    await advanceUssdDialogue(withChoices, "2", { engine });
    expect(engine.calls.submitted).toEqual([{ sessionId: "session-1", choiceId: "no" }]);
  });

  it("passes an unmatched keypress through as free text", async () => {
    const engine = engineStub(turn({ messageKey: "pathway.generic.onset" }));
    await advanceUssdDialogue(conversing, "8", { engine });
    expect(engine.calls.submitted).toEqual([{ sessionId: "session-1", text: "8" }]);
  });

  it("keeps every screen inside the provider budget", async () => {
    const engine = engineStub(
      turn({
        text: "z".repeat(400),
        choices: Array.from({ length: 6 }, (_unused, index) => ({
          id: `c${index}`,
          label: `Choice number ${index}`,
          synonyms: [],
        })),
      }),
    );
    const result = await advanceUssdDialogue(conversing, "1", { engine });
    expect(result.response.text.length).toBeLessThanOrEqual(USSD_MAX_BODY_CHARS);
  });
});

describe("USSD safety behaviour", () => {
  const conversing = state({ currentStep: "conversation", disclosureAcknowledged: true });

  it("ends the dialogue immediately on a red-flag interrupt", async () => {
    const engine = engineStub(turn({ urgency: "emergency", interrupt: true, kind: "safety_notice" }));
    const result = await advanceUssdDialogue(conversing, "1", { engine });

    expect(result.response.kind).toBe("end");
    expect(result.response.text).toMatch(/needs emergency care NOW/i);
    expect(engine.calls.closed).toEqual(["session-1"]);
  });

  it("interrupts even when the prompt itself is an ordinary question", async () => {
    // Ordering must not let a red flag be queued behind further questioning.
    const engine = engineStub(turn({ urgency: "emergency", kind: "question" }));
    const result = await advanceUssdDialogue(conversing, "1", { engine });
    expect(result.response.kind).toBe("end");
    expect(result.response.text).toMatch(/emergency/i);
  });

  it("renders the emergency message in Kiswahili when that is the locale", async () => {
    const engine = engineStub(turn({ urgency: "emergency", interrupt: true, locale: "sw" }));
    const result = await advanceUssdDialogue({ ...conversing, locale: "sw" }, "1", { engine });
    expect(result.response.text).toMatch(/dharura/i);
  });

  it("uses the conservative message when the safety engine is unavailable", async () => {
    const engine = engineStub(
      turn({ kind: "safety_notice", urgency: "unknown", safetyUnavailable: true }),
    );
    const result = await advanceUssdDialogue(conversing, "1", { engine });
    expect(result.response.text).toMatch(/could not complete/i);
    expect(result.response.text).not.toMatch(/no urgent warning sign/i);
  });

  it("never claims reassurance for an unknown urgency", async () => {
    const engine = engineStub(turn({ kind: "safety_notice", urgency: "unknown" }));
    const result = await advanceUssdDialogue(conversing, "1", { engine });
    expect(result.response.text).toMatch(/not enough information/i);
  });
});

describe("USSD safety screens fit the provider budget", () => {
  const urgencies = ["emergency", "urgent_today", "soon", "monitor", "unknown"] as const;
  const locales = ["en", "sw"] as const;

  it.each(
    locales.flatMap((locale) => urgencies.map((urgency) => ({ locale, urgency }))),
  )(
    "renders the $urgency outcome intact in $locale, with the offer menu readable",
    async ({ locale, urgency }) => {
      const engine = engineStub(turn({ kind: "safety_notice", urgency, locale }));
      const result = await advanceUssdDialogue(
        state({ currentStep: "conversation", disclosureAcknowledged: true, locale }),
        "1",
        {
          engine,
          summaryDelivery: { offerAvailable: async () => true, deliver: async () => true },
        },
      );

      // Never truncated: an approved safety message must arrive whole, and any
      // option offered alongside it must be fully readable.
      expect(result.response.text).not.toContain("…");
      expect(result.response.text.length).toBeLessThanOrEqual(USSD_MAX_BODY_CHARS);
    },
  );

  it("ends on the intact safety message rather than truncating an option", async () => {
    const engine = engineStub(turn({ kind: "safety_notice", urgency: "monitor" }));
    // A pathological outcome string that leaves no room for a menu.
    const result = await advanceUssdDialogue(
      state({ currentStep: "conversation", disclosureAcknowledged: true }),
      "1",
      {
        engine,
        summaryDelivery: { offerAvailable: async () => true, deliver: async () => true },
      },
    );
    expect(result.response.text).not.toContain("…");
  });

  it("splits the outcome and the offer across screens when they do not fit", async () => {
    const engine = engineStub(turn({ kind: "safety_notice", urgency: "monitor" }));
    const deps = {
      engine,
      summaryDelivery: { offerAvailable: async () => true, deliver: async () => true },
    };

    const outcome = await advanceUssdDialogue(
      state({ currentStep: "conversation", disclosureAcknowledged: true }),
      "1",
      deps,
    );
    expect(outcome.response.text).toMatch(/no urgent warning sign found/i);

    if (outcome.state.currentStep === "safety_outcome") {
      const offer = await advanceUssdDialogue(outcome.state, "1", deps);
      expect(offer.response.text).toMatch(/1\. Send it to me on WhatsApp/);
      expect(offer.response.text.length).toBeLessThanOrEqual(USSD_MAX_BODY_CHARS);
    } else {
      // Combined onto one screen; the menu must still be present and whole.
      expect(outcome.response.text).toMatch(/1\. Send it to me on WhatsApp/);
    }
  });

  it("ends the dialogue if the caller does not continue past the outcome", async () => {
    const engine = engineStub();
    const result = await advanceUssdDialogue(
      state({
        currentStep: "safety_outcome",
        disclosureAcknowledged: true,
        pendingChoices: [{ id: "continue", labelKey: "channel.choice.continue", synonyms: [] }],
        pendingChoiceLabels: { continue: "Continue" },
      }),
      "9",
      { engine, summaryDelivery: { offerAvailable: async () => true, deliver: async () => true } },
    );
    expect(result.response.kind).toBe("end");
    expect(engine.calls.closed).toEqual(["session-1"]);
  });
});

describe("USSD interaction-depth budget", () => {
  it("hands the caller to a professional rather than faking a full assessment", async () => {
    const engine = engineStub(turn({ messageKey: "pathway.generic.onset" }));
    const exhausted = state({
      currentStep: "conversation",
      disclosureAcknowledged: true,
      screenCount: USSD_MAX_SCREENS,
    });
    const result = await advanceUssdDialogue(exhausted, "1", { engine });

    expect(result.response.kind).toBe("end");
    expect(result.response.text).toMatch(/cannot collect enough detail/i);
    expect(engine.calls.closed).toEqual(["session-1"]);
    expect(engine.calls.submitted).toHaveLength(0);
  });
});

describe("USSD summary delivery", () => {
  const conversing = state({ currentStep: "conversation", disclosureAcknowledged: true });

  it("offers delivery when another channel is available", async () => {
    const engine = engineStub(turn({ kind: "summary", urgency: "soon" }));
    const result = await advanceUssdDialogue(conversing, "1", {
      engine,
      summaryDelivery: { offerAvailable: async () => true, deliver: async () => true },
    });

    // "soon" is short enough to share one screen with the offer menu.
    expect(result.state.currentStep).toBe("summary_delivery");
    expect(result.response.kind).toBe("continue");
    expect(result.response.text).toMatch(/see a health professional soon/i);
    expect(result.response.text).toMatch(/1\. Send it to me on WhatsApp/);
  });

  it("closes without offering when no delivery channel exists", async () => {
    const engine = engineStub(turn({ kind: "summary", urgency: "monitor" }));
    const result = await advanceUssdDialogue(conversing, "1", { engine });
    expect(result.response.kind).toBe("end");
    expect(engine.calls.closed).toEqual(["session-1"]);
  });

  it("delivers and closes when the caller accepts", async () => {
    const engine = engineStub();
    const deliver = vi.fn(async () => true);
    const result = await advanceUssdDialogue(
      state({ currentStep: "summary_delivery", disclosureAcknowledged: true }),
      "1",
      { engine, summaryDelivery: { offerAvailable: async () => true, deliver } },
    );
    expect(deliver).toHaveBeenCalledOnce();
    expect(result.response.kind).toBe("end");
    expect(engine.calls.closed).toEqual(["session-1"]);
  });

  it("closes without delivering when the caller declines", async () => {
    const engine = engineStub();
    const deliver = vi.fn(async () => true);
    const result = await advanceUssdDialogue(
      state({ currentStep: "summary_delivery", disclosureAcknowledged: true }),
      "2",
      { engine, summaryDelivery: { offerAvailable: async () => true, deliver } },
    );
    expect(deliver).not.toHaveBeenCalled();
    expect(result.response.kind).toBe("end");
  });

  it("does not claim a summary was sent when delivery fails", async () => {
    const engine = engineStub();
    const result = await advanceUssdDialogue(
      state({ currentStep: "summary_delivery", disclosureAcknowledged: true }),
      "1",
      {
        engine,
        summaryDelivery: { offerAvailable: async () => true, deliver: async () => false },
      },
    );
    expect(result.response.text).toMatch(/could not be prepared/i);
  });
});

describe("USSD terminal state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ends cleanly if the aggregator sends another keypress after done", async () => {
    const engine = engineStub();
    const result = await advanceUssdDialogue(state({ currentStep: "done" }), "1", { engine });
    expect(result.response.kind).toBe("end");
    expect(result.response.text).toMatch(/closed/i);
  });
});
