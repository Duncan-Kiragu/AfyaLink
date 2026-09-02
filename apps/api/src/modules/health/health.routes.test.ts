import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

const app = createApp();

describe("health", () => {
  it("is live without backend checks", async () => {
    const response = await request(app).get("/api/v1/health/live");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("reports Redis readiness without credentials or session payloads", async () => {
    const response = await request(app).get("/api/v1/health/ready");
    expect([200, 503]).toContain(response.status);
    expect(typeof response.body.redis).toBe("boolean");
    expect(response.body.status).toBe(response.body.redis ? "ok" : "degraded");
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/redis:\/\//i);
    expect(serialized).not.toContain("transcript");
  });
});
