import type { ReportedFact, ReportedSymptom } from "@kkd/contracts";
import { describe, expect, it } from "vitest";
import type { ComplaintPathway, RequiredFieldEstablishment } from "./pathway-schema.js";
import { REQUIRED_FIELD_ID_PATTERN } from "./pathway-schema.js";
import { activePathways, isFieldEstablished, missingCriticalFields } from "./pathways.js";
import { complaintPathwaysV0_1_0Draft } from "./rule-sets/complaint-pathways.v0.1.0-draft.js";
import { redFlagsV0_1_0Draft } from "./rule-sets/red-flags.v0.1.0-draft.js";
import { redFlagsRuleSet } from "./registry.js";

function symptom(concept: string, extra: Partial<ReportedSymptom> = {}): ReportedSymptom {
  return { id: `s.${concept}`, concept, confidence: "explicit", ...extra };
}

function fact(kind: string, value: unknown): ReportedFact {
  return { id: `f.${kind}`, kind, value, confidence: "explicit" };
}

function context(
  symptoms: readonly ReportedSymptom[],
  facts: readonly ReportedFact[] = [],
) {
  return { symptoms, facts };
}

const PATHWAYS = redFlagsRuleSet.pathways;

/**
 * Spec §5.2: "Never translate 'not mentioned' into 'denied'." A field is established
 * when the patient settled it either way, never by silence.
 */
describe("establishing a required field", () => {
  describe("symptom_presence", () => {
    const requirement = { kind: "symptom_presence", concept: "breathlessness" } as const;

    it("is established by a report", () => {
      expect(isFieldEstablished(requirement, context([symptom("breathlessness")]))).toBe(
        true,
      );
    });

    it("is established by an explicit denial", () => {
      const denied = symptom("chest_pain", { deniedSymptoms: ["breathlessness"] });

      expect(isFieldEstablished(requirement, context([denied]))).toBe(true);
    });

    it("is not established by silence", () => {
      expect(isFieldEstablished(requirement, context([symptom("chest_pain")]))).toBe(
        false,
      );
    });

    it("is not established by an unrelated symptom's presence", () => {
      expect(isFieldEstablished(requirement, context([symptom("headache")]))).toBe(false);
    });
  });

  describe("symptom_attribute", () => {
    const requirement = {
      kind: "symptom_attribute",
      concept: "chest_pain",
      attribute: "severity",
    } as const;

    it("is established when the attribute is present", () => {
      expect(
        isFieldEstablished(
          requirement,
          context([symptom("chest_pain", { severity: 4 })]),
        ),
      ).toBe(true);
    });

    it("is established by a severity of zero, which is an answer", () => {
      expect(
        isFieldEstablished(
          requirement,
          context([symptom("chest_pain", { severity: 0 })]),
        ),
      ).toBe(true);
    });

    it("is not established when the symptom carries no such attribute", () => {
      expect(isFieldEstablished(requirement, context([symptom("chest_pain")]))).toBe(
        false,
      );
    });

    it("is established when the concept was explicitly denied", () => {
      // A denied symptom has no attributes left worth asking about.
      const denied = symptom("headache", { deniedSymptoms: ["chest_pain"] });

      expect(isFieldEstablished(requirement, context([denied]))).toBe(true);
    });

    it("is not established when the concept was never mentioned", () => {
      expect(isFieldEstablished(requirement, context([symptom("headache")]))).toBe(false);
    });
  });

  describe("measurement", () => {
    const requirement = {
      kind: "measurement",
      measurement: "temperature_c",
      unit: "C",
    } as const;

    it("is established by a usable measurement", () => {
      const fever = symptom("fever", {
        measurements: [{ name: "temperature_c", value: "37.4", unit: "C" }],
      });

      expect(isFieldEstablished(requirement, context([fever]))).toBe(true);
    });

    it("is not established by a measurement in another unit", () => {
      const fever = symptom("fever", {
        measurements: [{ name: "temperature_c", value: "99.3", unit: "F" }],
      });

      expect(isFieldEstablished(requirement, context([fever]))).toBe(false);
    });

    it("is not established by a value that is not a plain number", () => {
      const fever = symptom("fever", {
        measurements: [{ name: "temperature_c", value: "about 39", unit: "C" }],
      });

      expect(isFieldEstablished(requirement, context([fever]))).toBe(false);
    });
  });

  describe("fact", () => {
    const requirement = {
      kind: "fact",
      factKind: "exposure.recent_travel_risk_area",
    } as const;

    it("is established by a reported fact whatever its value", () => {
      for (const value of [true, false, "unsure"]) {
        expect(
          isFieldEstablished(
            requirement,
            context([], [fact("exposure.recent_travel_risk_area", value)]),
          ),
        ).toBe(true);
      }
    });

    it("is not established by a fact of another kind", () => {
      expect(
        isFieldEstablished(
          requirement,
          context([], [fact("exposure.recent_contact", true)]),
        ),
      ).toBe(false);
    });
  });

  it("treats an uncertain answer as established, not as silence", () => {
    // Spec §5.2 lists `uncertain` ("patient was unsure") and `unknown` ("not
    // established") as different states. Re-asking an unsure answer would loop.
    const unsure = symptom("breathlessness", { confidence: "uncertain" });

    expect(
      isFieldEstablished(
        { kind: "symptom_presence", concept: "breathlessness" },
        context([unsure]),
      ),
    ).toBe(true);
  });

  it("establishes an any_of field through either branch", () => {
    const requirement: RequiredFieldEstablishment = {
      kind: "any_of",
      establishedBy: [
        { kind: "measurement", measurement: "temperature_c", unit: "C" },
        { kind: "fact", factKind: "measurement.temperature_c.unavailable" },
      ],
    };

    const measured = symptom("fever", {
      measurements: [{ name: "temperature_c", value: "38.2", unit: "C" }],
    });

    expect(isFieldEstablished(requirement, context([measured]))).toBe(true);
    expect(
      isFieldEstablished(
        requirement,
        context(
          [symptom("fever")],
          [fact("measurement.temperature_c.unavailable", true)],
        ),
      ),
    ).toBe(true);
    expect(isFieldEstablished(requirement, context([symptom("fever")]))).toBe(false);
  });
});

describe("pathway activation", () => {
  it("activates on a reported presenting concept", () => {
    expect(
      activePathways(PATHWAYS, context([symptom("chest_pain")])).map((p) => p.id),
    ).toEqual(["pathway.chest_pain"]);
  });

  it("activates every pathway the reported complaints match, sorted by id", () => {
    const active = activePathways(
      PATHWAYS,
      context([symptom("fever"), symptom("abdominal_pain")]),
    );

    expect(active.map((pathway) => pathway.id)).toEqual([
      "pathway.abdominal_pain",
      "pathway.fever",
    ]);
  });

  it("activates on any of a pathway's presenting concepts", () => {
    for (const concept of ["bleeding", "uncontrolled_bleeding"]) {
      expect(
        activePathways(PATHWAYS, context([symptom(concept)])).map((p) => p.id),
      ).toEqual(["pathway.bleeding"]);
    }
  });

  it("is not activated by a denied concept", () => {
    const denied = symptom("headache", { deniedSymptoms: ["chest_pain"] });

    expect(activePathways(PATHWAYS, context([denied]))).toEqual([]);
  });

  it("activates nothing for a complaint no table covers", () => {
    expect(activePathways(PATHWAYS, context([symptom("headache")]))).toEqual([]);
  });
});

/** Spec §8.3.B step 5: "ask those questions before lower-value detail questions". */
describe("question prioritisation", () => {
  it("returns critical discriminators before detail, so the caller can take the first", () => {
    const missing = missingCriticalFields(
      activePathways(PATHWAYS, context([symptom("chest_pain")])),
      context([symptom("chest_pain")]),
    );

    expect(missing.map((field) => field.fieldId)).toEqual([
      "symptom.breathlessness",
      "symptom.chest_pain.severity",
      "symptom.chest_pain.onset",
      "symptom.chest_pain.duration",
    ]);
    expect(missing[0]?.questionKey).toBe("severity.question.breathlessness");
    expect(missing[0]?.pathwayIds).toEqual(["pathway.chest_pain"]);
  });

  it("omits fields the input already establishes", () => {
    const reported = context([
      symptom("chest_pain", { severity: 3, deniedSymptoms: ["breathlessness"] }),
    ]);

    expect(
      missingCriticalFields(activePathways(PATHWAYS, reported), reported).map(
        (field) => field.fieldId,
      ),
    ).toEqual(["symptom.chest_pain.onset", "symptom.chest_pain.duration"]);
  });

  it("orders by priority, then by field id, regardless of table order", () => {
    const pathway = (id: string, fields: ComplaintPathway["requiredFields"]) => ({
      id,
      version: "0.0.1",
      status: "draft" as const,
      presentingConcepts: ["cough"],
      requiredFields: fields,
    });
    const field = (id: string, priority: number) => ({
      id,
      priority,
      establishedBy: { kind: "symptom_presence" as const, concept: id },
      questionKey: `severity.question.${id}`,
    });

    const reported = context([symptom("cough")]);
    const missing = missingCriticalFields(
      [
        pathway("pathway.b", [field("symptom.zebra", 10), field("symptom.detail", 30)]),
        pathway("pathway.a", [field("symptom.alpha", 10)]),
      ],
      reported,
    );

    expect(missing.map((entry) => entry.fieldId)).toEqual([
      "symptom.alpha",
      "symptom.zebra",
      "symptom.detail",
    ]);
  });

  it("reports a field shared by two pathways once, at its most urgent priority", () => {
    const shared = {
      id: "symptom.breathlessness",
      establishedBy: { kind: "symptom_presence" as const, concept: "breathlessness" },
      questionKey: "severity.question.breathlessness",
    };
    const reported = context([symptom("cough")]);

    const missing = missingCriticalFields(
      [
        {
          id: "pathway.detail",
          version: "0.0.1",
          status: "draft",
          presentingConcepts: ["cough"],
          requiredFields: [{ ...shared, priority: 40 }],
        },
        {
          id: "pathway.critical",
          version: "0.0.1",
          status: "draft",
          presentingConcepts: ["cough"],
          requiredFields: [{ ...shared, priority: 10 }],
        },
      ],
      reported,
    );

    expect(missing).toHaveLength(1);
    expect(missing[0]?.priority).toBe(10);
    expect(missing[0]?.pathwayIds).toEqual(["pathway.critical", "pathway.detail"]);
  });
});

/**
 * A rule and a pathway must name the same fact the same way, or a rule could need an
 * input no question ever asks for.
 */
describe("rule and pathway vocabularies agree", () => {
  const covered = new Set<string>();
  for (const pathway of complaintPathwaysV0_1_0Draft) {
    for (const concept of pathway.presentingConcepts) {
      covered.add(`symptom.${concept}`);
    }
    for (const field of pathway.requiredFields) {
      covered.add(field.id);
    }
  }

  it("covers every required input of every shipped rule", () => {
    const uncovered = redFlagsV0_1_0Draft
      .flatMap((rule) => rule.requiredInputs)
      .filter((input) => !covered.has(input));

    expect(uncovered).toEqual([]);
  });

  it("uses well-formed field ids throughout", () => {
    for (const pathway of complaintPathwaysV0_1_0Draft) {
      for (const field of pathway.requiredFields) {
        expect(field.id).toMatch(REQUIRED_FIELD_ID_PATTERN);
      }
    }
  });

  it("ships no clinically approved pathway, matching the rule set", () => {
    // No clinical reviewer is assigned yet — see docs/clinical-rules/README.md.
    for (const pathway of complaintPathwaysV0_1_0Draft) {
      expect(pathway.status).toBe("draft");
    }
  });
});
