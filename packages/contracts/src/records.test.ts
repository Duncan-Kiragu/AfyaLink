import { describe, expect, it } from "vitest";
import { persistFactsInputSchema } from "./records.js";

describe("persistFactsInputSchema", () => {
  const fact = {
    entryType: "symptom" as const,
    conceptCode: "primary_experience",
    patientWording: "Abdominal pain began eight hours ago",
    valueJson: { severity: 7, confidence: "explicit" },
    effectiveAt: "2026-09-02T12:00:00.000Z",
    confidence: "explicit" as const,
  };

  it("accepts selected normalized facts", () => {
    const parsed = persistFactsInputSchema.parse({
      consentVersion: "records.persist.v1",
      sourceChannel: "web",
      facts: [fact],
    });
    expect(parsed.facts).toHaveLength(1);
  });

  it("rejects a raw conversation dump", () => {
    expect(() =>
      persistFactsInputSchema.parse({
        consentVersion: "records.persist.v1",
        sourceChannel: "web",
        facts: [fact],
        transcript: "Patient: I have malaria. Agent: What are you feeling?",
      }),
    ).toThrow();
  });
});
