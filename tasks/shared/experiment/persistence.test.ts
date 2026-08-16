import { describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "./types";
import { resultsEndpoint, submitSession } from "./persistence";

const payload = (): SessionPayload => ({
  session: {
    sessionId: "session-test",
    observerType: "human",
    startedAtUtc: "2026-08-16T00:00:00.000Z",
    randomSeed: 1,
  },
  results: [],
  trajectories: [],
});

describe("results endpoint", () => {
  it("uses the same-origin API by default", () => {
    expect(resultsEndpoint({})).toBeUndefined();
  });

  it("uses a configured endpoint for a separately deployed API", () => {
    expect(resultsEndpoint({ VITE_RESULTS_ENDPOINT: "https://api.example.test/sessions" }))
      .toBe("https://api.example.test/sessions");
  });

  it("ignores an empty configured endpoint", () => {
    expect(resultsEndpoint({ VITE_RESULTS_ENDPOINT: "" })).toBeUndefined();
  });
});

describe("submitSession", () => {
  it("does not call fetch when no endpoint is configured", async () => {
    const fetchImpl = vi.fn();

    await submitSession(payload(), { endpoint: "", fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the idempotent session payload and reports attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const onAttempt = vi.fn();

    await submitSession(payload(), {
      endpoint: "https://api.example.test/sessions",
      fetchImpl,
      onAttempt,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://api.example.test/sessions");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "Idempotency-Key": "session-test",
    });
    expect(JSON.parse(String(init.body))).toEqual(payload());
    expect(onAttempt).toHaveBeenCalledWith(1, 3);
  });

  it("retries bounded failures with the same request body", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(submitSession(payload(), {
      endpoint: "https://api.example.test/sessions",
      fetchImpl,
      maxAttempts: 3,
      sleep,
    })).rejects.toMatchObject({ kind: "network" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map(([, init]) => String((init as RequestInit).body));
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify(payload())]));
    const headers = fetchImpl.mock.calls.map(([, init]) => (init as RequestInit).headers);
    expect(headers).toEqual([
      { "Content-Type": "application/json", "Idempotency-Key": "session-test" },
      { "Content-Type": "application/json", "Idempotency-Key": "session-test" },
      { "Content-Type": "application/json", "Idempotency-Key": "session-test" },
    ]);
  });

  it("classifies a non-success response without reading its body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("large body", { status: 503 }));

    await expect(submitSession(payload(), {
      endpoint: "https://api.example.test/sessions",
      fetchImpl,
      maxAttempts: 1,
    })).rejects.toMatchObject({ kind: "http", status: 503 });
  });
});
