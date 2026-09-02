import { describe, it, expect } from "vitest";
import { routeToCareCategory } from "../care-routing.js";
import { type ReportedSymptom, type UrgencyClass } from "@kkd/contracts";

describe("Care Routing", () => {
  const makeSymptom = (concept: string, patientWording?: string): ReportedSymptom => ({
    id: "test-1",
    concept,
    patientWording,
    confidence: "explicit",
  });

  describe("emergency routing", () => {
    it("should always route emergency to emergency_department", () => {
      const input = {
        urgency: "emergency" as UrgencyClass,
        reportedSymptoms: [makeSymptom("eye_pain")],
      };
      expect(routeToCareCategory(input)).toBe("emergency_department");
    });

    it("should prioritize emergency over specialty routing", () => {
      const input = {
        urgency: "emergency" as UrgencyClass,
        reportedSymptoms: [makeSymptom("pregnancy")],
      };
      expect(routeToCareCategory(input)).toBe("emergency_department");
    });
  });

  describe("obstetric routing", () => {
    it("should route pregnancy concept to obstetric_care", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("pregnancy")],
      };
      expect(routeToCareCategory(input)).toBe("obstetric_care");
    });

    it("should route obstetric concept to obstetric_care", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("obstetric_complication")],
      };
      expect(routeToCareCategory(input)).toBe("obstetric_care");
    });

    it("should route 'pregnant' patient wording to obstetric_care", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("abdominal_pain", "I am pregnant and have pain")],
      };
      expect(routeToCareCategory(input)).toBe("obstetric_care");
    });
  });

  describe("eye care routing", () => {
    it("should route eye symptoms to eye_care", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("eye_pain")],
      };
      expect(routeToCareCategory(input)).toBe("eye_care");
    });

    it("should route eye concepts to eye_care", () => {
      const input = {
        urgency: "monitor" as UrgencyClass,
        reportedSymptoms: [makeSymptom("vision_blurring")],
      };
      expect(routeToCareCategory(input)).toBe("primary_care");
    });
  });

  describe("dental care routing", () => {
    it("should route dental symptoms to dental_care", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("dental_pain")],
      };
      expect(routeToCareCategory(input)).toBe("dental_care");
    });

    it("should route tooth symptoms to dental_care", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("tooth_ache")],
      };
      expect(routeToCareCategory(input)).toBe("dental_care");
    });
  });

  describe("mental health routing", () => {
    it("should route mental health symptoms to mental_health", () => {
      const input = {
        urgency: "monitor" as UrgencyClass,
        reportedSymptoms: [makeSymptom("mental_distress")],
      };
      expect(routeToCareCategory(input)).toBe("mental_health");
    });

    it("should route depression to mental_health", () => {
      const input = {
        urgency: "monitor" as UrgencyClass,
        reportedSymptoms: [makeSymptom("depression")],
      };
      expect(routeToCareCategory(input)).toBe("mental_health");
    });

    it("should route anxiety to mental_health", () => {
      const input = {
        urgency: "monitor" as UrgencyClass,
        reportedSymptoms: [makeSymptom("anxiety")],
      };
      expect(routeToCareCategory(input)).toBe("mental_health");
    });
  });

  describe("pediatric routing", () => {
    it("should route young children to paediatrics", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("fever")],
        patientAge: 3,
      };
      expect(routeToCareCategory(input)).toBe("paediatrics");
    });

    it("should not route to paediatrics for age >= 5", () => {
      const input = {
        urgency: "soon" as UrgencyClass,
        reportedSymptoms: [makeSymptom("fever")],
        patientAge: 5,
      };
      expect(routeToCareCategory(input)).toBe("primary_care");
    });
  });

  describe("default routing", () => {
    it("should route generic symptoms to primary_care", () => {
      const input = {
        urgency: "monitor" as UrgencyClass,
        reportedSymptoms: [makeSymptom("abdominal_pain")],
      };
      expect(routeToCareCategory(input)).toBe("primary_care");
    });

    it("should route empty symptoms to primary_care", () => {
      const input = {
        urgency: "monitor" as UrgencyClass,
        reportedSymptoms: [],
      };
      expect(routeToCareCategory(input)).toBe("primary_care");
    });

    it("should route unknown urgency to primary_care", () => {
      const input = {
        urgency: "unknown" as UrgencyClass,
        reportedSymptoms: [makeSymptom("headache")],
      };
      expect(routeToCareCategory(input)).toBe("primary_care");
    });
  });
});
