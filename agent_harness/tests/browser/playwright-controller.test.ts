import { describe, expect, it } from "vitest";

import { PlaywrightBrowserHost } from "../../src/browser/playwright-controller";
import type {
  BrowserContextPort,
  BrowserLauncherPort,
  BrowserPagePort,
  BrowserPort,
} from "../../src/browser/browser-types";

function createFixture() {
  const events: unknown[] = [];
  const page: BrowserPagePort = {
    mouse: {
      move: async (x, y) => { events.push(["move", x, y]); },
      click: async (x, y) => { events.push(["click", x, y]); },
    },
    goto: async (url, options) => { events.push(["goto", url, options]); },
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
  return { events, launcher, launches: () => launches };
}

describe("PlaywrightBrowserHost", () => {
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
    expect(fixture.events).toContainEqual(["move", 540, 338]);
    expect(fixture.events).toContainEqual(["click", 756, 386]);
    expect(Object.keys(session).sort()).toEqual(["click", "close", "move", "screenshot"]);
  });
});
