import { describe, expect, it } from "vitest";
import type { ReportedFact } from "@kkd/contracts";
import { extractSymptom, mapExtractedFactsToSymptoms } from "./extracted-facts.js";

function fact(kind: string, value: unknown, id = kind): ReportedFact {
  return { id, kind, value, confidence: "explicit" };
}

describe("mapExtractedFactsToSymptoms", () => {
  it("returns the regex stub when Claude facts are empty or blank", () => {
    const text = "headache since yesterday 4/10";
    const stub = extractSymptom(text);
    const [empty] = mapExtractedFactsToSymptoms([], text);
    const [blank] = mapExtractedFactsToSymptoms([fact("location", "  ")], text);

    for (const mapped of [empty, blank]) {
      expect(mapped?.concept).toBe(stub.concept);
      expect(mapped?.patientWording).toBe(text);
      expect(mapped?.severity).toBe(4);
      expect(mapped?.duration).toBe(text);
      expect(mapped?.onset).toBe(text);
    }
  });

  it("maps location, timeline, severity, denials, associated symptoms, and measurements", () => {
    const text = "Pain on the left side";
    const [symptom] = mapExtractedFactsToSymptoms(
      [
        fact("body_location", "left abdomen"),
        fact("timeline", "since this morning"),
        fact("duration", "six hours"),
        fact("pain", "7/10"),
        fact("denied_symptom", "fever"),
        fact("associated_symptom", "nausea"),
        fact("measurement", "temperature 38"),
      ],
      text,
    );

    expect(symptom?.concept).toBe("reported_experience");
    expect(symptom?.patientWording).toBe(text);
    expect(symptom?.location).toBe("left abdomen");
    expect(symptom?.onset).toBe("since this morning");
    expect(symptom?.duration).toBe("six hours");
    expect(symptom?.severity).toBe(7);
    expect(symptom?.deniedSymptoms).toEqual(["fever"]);
    expect(symptom?.associatedSymptoms).toEqual(["nausea"]);
    expect(symptom?.measurements).toEqual([{ name: "measurement", value: "temperature 38" }]);
  });

  it("maps onset and intensity kinds onto existing symptom fields", () => {
    const [symptom] = mapExtractedFactsToSymptoms(
      [fact("onset", "yesterday"), fact("intensity", 9)],
      "it is worse at night",
    );
    expect(symptom?.onset).toBe("yesterday");
    expect(symptom?.severity).toBe(9);
  });

  it("ignores pain without a 0–10 number and never uses a disease name as concept", () => {
    const [symptom] = mapExtractedFactsToSymptoms(
      [fact("pain", "throbbing"), fact("malaria", "malaria")],
      "throbbing in my head",
    );
    expect(symptom?.concept).toBe("reported_experience");
    expect(symptom?.concept).not.toMatch(/malaria/i);
    expect(symptom?.severity).toBeUndefined();
    expect(symptom?.patientWording).toBe("throbbing in my head");
  });

  it("treats self-labels as unspecified_symptom", () => {
    const [fromText] = mapExtractedFactsToSymptoms(
      [fact("location", "head")],
      "I think I have malaria, my head hurts",
    );
    expect(fromText?.concept).toBe("unspecified_symptom");
    expect(fromText?.confidence).toBe("uncertain");
    expect(fromText?.location).toBe("head");

    const [fromKind] = mapExtractedFactsToSymptoms(
      [fact("self_label_not_a_diagnosis", "malaria")],
      "my head hurts",
    );
    expect(fromKind?.concept).toBe("unspecified_symptom");
    expect(fromKind?.patientWording).toBe("my head hurts");
  });

  it("reads measurement name and value from an object without adding fields", () => {
    const [symptom] = mapExtractedFactsToSymptoms(
      [fact("measurement", { name: "temperature", value: "38" })],
      "I took my temperature",
    );
    expect(symptom?.measurements).toEqual([{ name: "temperature", value: "38" }]);
  });
});
