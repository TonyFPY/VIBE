import { describe, expect, it } from "vitest";

import { PlaywrightBrowserHost } from "../../src/browser/playwright-controller";
import type {
  BrowserContextPort,
  BrowserLauncherPort,
  BrowserPagePort,
  BrowserPort,
  BrowserRequestFailurePort,
  BrowserResponsePort,
} from "../../src/browser/browser-types";

function createFixture() {
  const events: unknown[] = [];
  const responseListeners: Array<(response: BrowserResponsePort) => void> = [];
  const requestFailedListeners: Array<(request: BrowserRequestFailurePort) => void> = [];
  const page: BrowserPagePort = {
    mouse: {
      move: async (x, y, options) => { events.push(["move", x, y, ...(options ? [options] : [])]); },
      click: async (x, y) => { events.push(["click", x, y]); },
    },
    on: (event, listener) => {
      events.push(["on", event]);
      if (event === "response") responseListeners.push(listener as (response: BrowserResponsePort) => void);
      else requestFailedListeners.push(listener as (request: BrowserRequestFailurePort) => void);
    },
    off: (event, listener) => {
      events.push(["off", event]);
      if (event === "response") responseListeners.splice(responseListeners.indexOf(listener as (response: BrowserResponsePort) => void), 1);
      else requestFailedListeners.splice(requestFailedListeners.indexOf(listener as (request: BrowserRequestFailurePort) => void), 1);
    },
    goto: async (url, options) => { events.push(["goto", url, options]); },
    evaluate: async (expression) => { events.push(["evaluate", expression]); },
    screenshot: async (options) => {
      events.push(["screenshot", options]);
      return Uint8Array.from([0xff, 0xd8, 0xff]);
    },
  };
  const context: BrowserContextPort = {
    newPage: async () => page,
    close: async () => { events.push(["context-close"]); },
  };
  const browser: BrowserPort = {
    newContext: async (options) => {
      events.push(["new-context", options]);
      return context;
    },
    close: async () => { events.push(["browser-close"]); },
  };
  let launches = 0;
  const launcher: BrowserLauncherPort = {
    launch: async (options) => {
      launches += 1;
      events.push(["launch", options]);
      return browser;
    },
  };
  return {
    events,
    launcher,
    launches: () => launches,
    emitResponse: (response: BrowserResponsePort) => responseListeners.forEach((listener) => listener(response)),
    emitRequestFailed: (request: BrowserRequestFailurePort) => requestFailedListeners.forEach((listener) => listener(request)),
  };
}

describe("PlaywrightBrowserHost", () => {
  it("defaults to headless and supports headed Chromium", async () => {
    const headlessFixture = createFixture();
    const headlessHost = new PlaywrightBrowserHost({ launcher: headlessFixture.launcher, settleDelayMs: 0, navigationTimeoutMs: 10_000 });
    const headlessSession = await headlessHost.openSession("https://example.test/tasks/visual-similarity", { width: 1080, height: 675 });
    await headlessSession.close();
    await headlessHost.close();

    const headedFixture = createFixture();
    const headedHost = new PlaywrightBrowserHost({ launcher: headedFixture.launcher, headless: false, settleDelayMs: 0, navigationTimeoutMs: 10_000 });
    const headedSession = await headedHost.openSession("https://example.test/tasks/visual-similarity", { width: 1080, height: 675 });
    await headedSession.move(540, 338);
    await headedSession.screenshot(90);
    await headedSession.close();
    await headedHost.close();

    expect(headlessFixture.events).toContainEqual(["launch", { headless: true }]);
    expect(headedFixture.events).toContainEqual(["launch", { headless: false }]);
    expect(headedFixture.events.some((event) => Array.isArray(event) && event[0] === "evaluate" && String(event[1]).includes("agent-harness-cursor"))).toBe(true);
    expect(headedFixture.events.some((event) => Array.isArray(event) && event[0] === "evaluate" && String(event[1]).includes("style.display"))).toBe(true);
  });

  it("reuses Chromium while isolating each run in a scale-factor-one context", async () => {
    const fixture = createFixture();
    const host = new PlaywrightBrowserHost({ launcher: fixture.launcher, settleDelayMs: 0, navigationTimeoutMs: 10_000 });
    const first = await host.openSession("https://example.test/tasks/visual-similarity", { width: 1080, height: 675 });
    await first.close();
    const second = await host.openSession("https://example.test/tasks/object-matching", { width: 1080, height: 675 });
    await second.close();
    await host.close();

    expect(fixture.launches()).toBe(1);
    expect(fixture.events.filter((event) => Array.isArray(event) && event[0] === "new-context")).toEqual([
      ["new-context", { viewport: { width: 1080, height: 675 }, deviceScaleFactor: 1 }],
      ["new-context", { viewport: { width: 1080, height: 675 }, deviceScaleFactor: 1 }],
    ]);
    expect(fixture.events.filter((event) => Array.isArray(event) && event[0] === "context-close")).toHaveLength(2);
    expect(fixture.events.at(-1)).toEqual(["browser-close"]);
  });

  it("captures JPEG directly and exposes only pointer controls", async () => {
    const fixture = createFixture();
    const host = new PlaywrightBrowserHost({ launcher: fixture.launcher, settleDelayMs: 0, navigationTimeoutMs: 10_000 });
    const session = await host.openSession("https://example.test/tasks/visual-similarity", { width: 1080, height: 675 });

    await expect(session.screenshot(90)).resolves.toEqual(Uint8Array.from([0xff, 0xd8, 0xff]));
    await session.move(540, 338);
    await session.click(756, 386);

    expect(fixture.events).toContainEqual(["screenshot", { type: "jpeg", quality: 90 }]);
    expect(fixture.events).toContainEqual(["move", 540, 338, { steps: 1 }]);
    expect(fixture.events).toContainEqual(["click", 756, 386]);
    expect(Object.keys(session).sort()).toEqual(["click", "close", "move", "screenshot", "subscribeBackendEvents"]);
  });

  it("forwards only evaluator result metadata and removes backend listeners on close", async () => {
    const fixture = createFixture();
    const host = new PlaywrightBrowserHost({ launcher: fixture.launcher, settleDelayMs: 0, navigationTimeoutMs: 10_000 });
    const session = await host.openSession("https://example.test/tasks/visual-similarity", { width: 1080, height: 675 });
    const received: unknown[] = [];
    session.subscribeBackendEvents((event) => received.push(event));

    fixture.emitResponse({
      request: () => ({ method: () => "POST", url: () => "https://example.test/api/experiments/sessions", failure: () => null }),
      status: () => 200,
      ok: () => true,
    });
    fixture.emitResponse({
      request: () => ({ method: () => "GET", url: () => "https://example.test/api/experiments/sessions", failure: () => null }),
      status: () => 500,
      ok: () => false,
    });
    fixture.emitResponse({
      request: () => ({ method: () => "POST", url: () => "https://example.test/api/experiments/other", failure: () => null }),
      status: () => 201,
      ok: () => true,
    });
    fixture.emitRequestFailed({
      method: () => "POST",
      url: () => "https://example.test/api/experiments/sessions",
      failure: () => ({ errorText: "https://evil.test/?body=SECRET_RESPONSE_BODY_OR_HEADERS" }),
    });

    expect(received).toEqual([
      { type: "results-response", status: 200, ok: true },
      { type: "results-request-failed", error: "result request failed" },
    ]);
    expect(JSON.stringify(received)).not.toContain("evil.test");
    expect(JSON.stringify(received)).not.toContain("SECRET_RESPONSE_BODY_OR_HEADERS");
    await session.close();
    expect(fixture.events.filter((event) => Array.isArray(event) && event[0] === "off")).toEqual([
      ["off", "response"],
      ["off", "requestfailed"],
    ]);
    fixture.emitRequestFailed({
      method: () => "POST",
      url: () => "https://example.test/api/experiments/sessions",
      failure: () => ({ errorText: "late" }),
    });
    expect(received).toHaveLength(2);
  });

  it("uses the configured deterministic mouse movement steps", async () => {
    const fixture = createFixture();
    const host = new PlaywrightBrowserHost({ launcher: fixture.launcher, settleDelayMs: 0, navigationTimeoutMs: 10_000, mouseMoveSteps: 7 });
    const session = await host.openSession("https://example.test/tasks/visual-similarity", { width: 1080, height: 675 });
    await session.move(540, 338);
    expect(fixture.events).toContainEqual(["move", 540, 338, { steps: 7 }]);
    await session.close();
  });
});
