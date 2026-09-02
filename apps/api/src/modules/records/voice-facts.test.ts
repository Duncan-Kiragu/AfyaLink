import { describe, expect, it } from "vitest";
import type { KkdSession } from "@kkd/contracts";
import { voiceSessionToPersistableFacts } from "./voice-facts.js";

function session(overrides: Partial<KkdSession> = {}): KkdSession {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    mode: "anonymous_ephemeral",
    channel: "voice",
    locale: "en",
    createdAt: "2026-09-02T10:00:00.000Z",
    lastActivityAt: "2026-09-02T10:05:00.000Z",
    disclosureVersion: "voice.v1",
    facts: [
      {
        id: "fact-self",
        kind: "self_label_not_a_diagnosis",
        value: "I think I have malaria",
        confidence: "explicit",
      },
    ],
    symptoms: [
      {
        id: "sym-1",
        concept: "reported_experience",
        patientWording: "Stomach pain since morning",
        onset: "this morning",
        severity: 6,
        confidence: "explicit",
      },
      {
        id: "sym-2",
        concept: "reported_experience",
        patientWording: "Skipped — not selected",
        confidence: "explicit",
      },
    ],
    safety: {
      urgency: "unknown",
      ruleIds: [],
      explanationKeys: [],
      missingCriticalFacts: [],
      requiresHumanEscalation: false,
      ruleSetVersion: "red-flags@0.1.0-draft",
    },
    completion: { percent: 20, missingFieldIds: ["onset_or_duration"] },
    ...overrides,
  };
}

describe("voiceSessionToPersistableFacts", () => {
  it("maps only selected symptoms and never copies a self-label", () => {
    const facts = voiceSessionToPersistableFacts(session(), ["sym-1", "fact-self"]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.patientWording).toBe("Stomach pain since morning");
    expect(facts[0]?.valueJson?.severity).toBe(6);
    expect(JSON.stringify(facts)).not.toMatch(/malaria/i);
  });

  it("returns nothing when the selected ids are not symptoms", () => {
    expect(voiceSessionToPersistableFacts(session(), ["fact-self"])).toEqual([]);
  });
});
