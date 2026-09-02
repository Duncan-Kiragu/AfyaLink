import { describe, expect, it } from "vitest";
import { containsDiagnosticLanguage, stripDiagnosticLanguage } from "./diagnosis-guard.js";

describe("diagnosis-language guard", () => {
  it("rejects English diagnostic speculation", () => {
    expect(containsDiagnosticLanguage("This sounds like malaria")).toBe(true);
  });

  it("keeps factual symptom language", () => {
    expect(containsDiagnosticLanguage("Abdominal pain began eight hours ago")).toBe(false);
  });

  it("rewrites diagnostic text", () => {
    expect(stripDiagnosticLanguage("You may have appendicitis")).not.toMatch(/appendicitis/i);
  });

  it("rejects Kiswahili diagnostic speculation", () => {
    expect(containsDiagnosticLanguage("Una ugonjwa wa malaria")).toBe(true);
  });
});
