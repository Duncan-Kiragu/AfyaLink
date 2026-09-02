import type { PiiFinding } from "@kkd/contracts";
import { piiSyntheticExamples } from "@kkd/testing";
import { describe, expect, it, vi } from "vitest";
import { PiiRedactionFailedError } from "./errors.js";
import { PresidioPiiService } from "./presidio-pii-service.js";
import { InMemorySessionPlaceholderStore } from "./session-store.js";
import type { PiiAnalyzer } from "./types.js";

function analyzerReturning(
  entities: Array<{ type: PiiFinding["type"]; start: number; end: number }>,
): PiiAnalyzer {
  return {
    analyze: async () => entities,
  };
}

function service(analyzer: PiiAnalyzer, store = new InMemorySessionPlaceholderStore()) {
  return new PresidioPiiService({
    analyzer,
    placeholderStore: store,
    organizationIdentifiers: ["ACME-CLINIC-99"],
  });
}

describe("PresidioPiiService", () => {
  it("detects Kenyan phones, emails, IDs, coordinates, and URL identifiers", async () => {
    const pii = service(analyzerReturning([]));
    const text = [
      `Call ${piiSyntheticExamples.phones[0]} or ${piiSyntheticExamples.phones[2]}`,
      `email ${piiSyntheticExamples.emails[0]}`,
      piiSyntheticExamples.ids[0],
      `gps ${piiSyntheticExamples.coordinates[0]}`,
      piiSyntheticExamples.urls[0],
      "org ACME-CLINIC-99",
    ].join(" ");

    const findings = await pii.detect(text);
    const types = new Set(findings.map((finding) => finding.type));
    expect(types.has("phone")).toBe(true);
    expect(types.has("email")).toBe(true);
    expect(types.has("national_id")).toBe(true);
    expect(types.has("coordinates")).toBe(true);
    expect(types.has("account_reference")).toBe(true);
    expect(types.has("org_identifier")).toBe(true);
  });

  it("preserves medical measurements and body locations", async () => {
    const pii = service(analyzerReturning([]));
    for (const sample of piiSyntheticExamples.falsePositives) {
      const findings = await pii.detect(sample);
      expect(findings, sample).toEqual([]);
      const sanitized = await pii.sanitizeObject({ note: sample }, "log");
      expect(sanitized.note).toBe(sample);
    }
  });

  it("redacts names from Presidio NER and from Kiswahili introductions", async () => {
    const text = "Jina langu ni John Kamau na tumbo linauma";
    const nameStart = text.indexOf("John Kamau");
    const pii = service(
      analyzerReturning([
        { type: "person_name", start: nameStart, end: nameStart + "John Kamau".length },
      ]),
    );

    const sanitized = await pii.sanitizeObject({ patientText: text }, "ai");
    expect(sanitized.patientText).toContain("[PERSON_1]");
    expect(sanitized.patientText).not.toContain("John Kamau");
    expect(sanitized.patientText).toContain("tumbo linauma");
  });

  it("uses irreversible tokens for logs and reversible placeholders for AI", async () => {
    const pii = service(analyzerReturning([]));
    const payload = { patientText: "email patient@example.com and 0712345678" };

    const logged = await pii.sanitizeObject(payload, "log");
    expect(logged.patientText).toContain("[REDACTED:email]");
    expect(logged.patientText).toContain("[REDACTED:phone]");
    expect(logged.patientText).not.toContain("patient@example.com");

    const forAi = await pii.sanitizeObject(payload, "ai");
    expect(forAi.patientText).toContain("[EMAIL_1]");
    expect(forAi.patientText).toContain("[PHONE_1]");
  });

  it("stores and restores session-reversible placeholders, then deletes them", async () => {
    const store = new InMemorySessionPlaceholderStore();
    const pii = service(analyzerReturning([]), store);
    const original = "Nipigie 0712345678";

    const redacted = await pii.sanitizeObject(original, "session_reversible", {
      sessionId: "session-1",
    });
    expect(redacted).toContain("[PHONE_1]");
    expect(await pii.restore(redacted, "session-1")).toBe(original);

    await pii.clearSession("session-1");
    expect(await pii.restore(redacted, "session-1")).toBe(redacted);
  });

  it("fails closed for AI when Presidio is unavailable", async () => {
    const pii = new PresidioPiiService({
      analyzer: {
        analyze: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    });

    await expect(
      pii.sanitizeObject("John Kamau has abdominal pain", "ai"),
    ).rejects.toBeInstanceOf(PiiRedactionFailedError);
  });

  it("does not fail logs when Presidio is down", async () => {
    const pii = new PresidioPiiService({
      analyzer: {
        analyze: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    });

    const logged = await pii.sanitizeObject(
      { err: "failed for patient@example.com" },
      "log",
    );
    expect(logged.err).toBe(
      "failed for patient@example.com".replace("patient@example.com", "[REDACTED:email]"),
    );
  });

  it("fails closed for AI when no analyzer is configured", async () => {
    const pii = new PresidioPiiService();
    await expect(pii.sanitizeObject("hello", "ai")).rejects.toBeInstanceOf(
      PiiRedactionFailedError,
    );
  });

  it("scrubs fake PII out of thrown error payloads for log policy", async () => {
    const pii = service(analyzerReturning([]));
    const error = new Error("upstream 500 for 0712345678 / patient@example.com");
    const sanitized = await pii.sanitizeObject(
      { message: error.message, stack: `${error.stack}` },
      "log",
    );
    expect(sanitized.message).not.toContain("0712345678");
    expect(sanitized.message).not.toContain("patient@example.com");
    expect(sanitized.stack).not.toContain("0712345678");
  });

  it("forwards Kenyan ad-hoc recognizers to Presidio analyze", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ start: 13, end: 23, score: 0.9, entity_type: "PERSON" }],
    });
    const { PresidioAnalyzerClient } = await import("./presidio-client.js");
    const client = new PresidioAnalyzerClient({
      baseUrl: "http://presidio.test",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const text = "My name is Amina Hassan";
    const entities = await client.analyze(text);
    expect(entities).toEqual([{ type: "person_name", start: 13, end: 23, score: 0.9 }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as {
      ad_hoc_recognizers: Array<{ name: string }>;
    };
    expect(body.ad_hoc_recognizers.map((item) => item.name)).toContain("Kenyan phone");
  });
});
