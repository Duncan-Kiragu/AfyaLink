import { describe, expect, it } from "vitest";
import { resources, safetyCriticalKeys } from "./index.js";

describe("i18n resources", () => {
  it("keeps English and Kiswahili keys aligned", () => {
    const enKeys = Object.keys(resources.en.translation).sort();
    const swKeys = Object.keys(resources.sw.translation).sort();
    expect(swKeys).toEqual(enKeys);
  });

  it("includes safety-critical keys in both locales", () => {
    for (const key of safetyCriticalKeys) {
      expect(resources.en.translation).toHaveProperty(key);
      expect(resources.sw.translation).toHaveProperty(key);
    }
  });
});
