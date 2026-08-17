import { chromium } from "playwright";

import type {
  BrowserHost,
  BrowserLauncherPort,
  BrowserPagePort,
  BrowserPort,
  BrowserRequestFailurePort,
  BrowserResponsePort,
  BackendEvent,
  BrowserSession,
} from "./browser-types";

export interface PlaywrightBrowserHostOptions {
  launcher?: BrowserLauncherPort;
  headless?: boolean;
  settleDelayMs: number;
  navigationTimeoutMs: number;
  mouseMoveSteps?: number;
}

const defaultLauncher: BrowserLauncherPort = {
  launch: async (options) => chromium.launch(options) as Promise<BrowserPort>,
};

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function cursorOverlayScript(x: number, y: number, clicked: boolean): string {
  const encodedX = JSON.stringify(x);
  const encodedY = JSON.stringify(y);
  const encodedClicked = JSON.stringify(clicked);
  return `(() => {
    const id = "agent-harness-cursor";
    let cursor = document.getElementById(id);
    if (!cursor) {
      cursor = document.createElement("div");
      cursor.id = id;
      cursor.setAttribute("aria-hidden", "true");
      Object.assign(cursor.style, {
        position: "fixed",
        width: "18px",
        height: "18px",
        border: "2px solid #d11",
        borderRadius: "50%",
        background: "rgba(255, 70, 70, 0.22)",
        boxShadow: "0 0 0 2px rgba(255,255,255,0.9), 0 0 8px rgba(0,0,0,0.55)",
        pointerEvents: "none",
        zIndex: "2147483647",
        transform: "translate(-50%, -50%)",
      });
      document.documentElement.appendChild(cursor);
    }
    cursor.style.left = ${encodedX} + "px";
    cursor.style.top = ${encodedY} + "px";
    cursor.style.background = ${encodedClicked}
      ? "rgba(255, 190, 0, 0.58)"
      : "rgba(255, 70, 70, 0.22)";
  })()`;
}

function cursorVisibilityScript(visible: boolean): string {
  return `(() => {
    const cursor = document.getElementById("agent-harness-cursor");
    if (cursor) cursor.style.display = ${JSON.stringify(visible ? "block" : "none")};
  })()`;
}

const resultsPathname = "/api/experiments/sessions";
const maxBackendErrorLength = 200;

export class PlaywrightBrowserHost implements BrowserHost {
  private browserPromise?: Promise<BrowserPort>;
  private closed = false;

  constructor(private readonly options: PlaywrightBrowserHostOptions) {}

  async openSession(
    url: string,
    viewport: { width: 1080; height: 675 },
  ): Promise<BrowserSession> {
    if (this.closed) throw new Error("Browser host is closed");
    const browser = await this.browser();
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const subscribers = new Set<(event: BackendEvent) => void>();
      const isResultsRequest = (request: { method(): string; url(): string }): boolean => {
        if (request.method() !== "POST") return false;
        try {
          return new URL(request.url()).pathname === resultsPathname;
        } catch {
          return false;
        }
      };
      const responseListener = (response: BrowserResponsePort) => {
        if (!isResultsRequest(response.request())) return;
        const event: BackendEvent = { type: "results-response", status: response.status(), ok: response.ok() };
        subscribers.forEach((listener) => listener(event));
      };
      const requestFailedListener = (request: BrowserRequestFailurePort) => {
        if (!isResultsRequest(request)) return;
        const error = request.failure()?.errorText || "Request failed";
        subscribers.forEach((listener) => listener({
          type: "results-request-failed",
          error: error.slice(0, maxBackendErrorLength),
        }));
      };
      page.on("response", responseListener);
      page.on("requestfailed", requestFailedListener);
      await page.goto(url, { waitUntil: "load", timeout: this.options.navigationTimeoutMs });
      await wait(this.options.settleDelayMs);
      let sessionClosed = false;
      const cursorEnabled = this.options.headless === false && page.evaluate;
      const assertOpen = () => {
        if (sessionClosed) throw new Error("Browser session is closed");
      };
      return Object.freeze({
        screenshot: async (quality: number) => {
          assertOpen();
          if (cursorEnabled) await page.evaluate!(cursorVisibilityScript(false));
          try {
            return await page.screenshot({ type: "jpeg", quality });
          } finally {
            if (cursorEnabled) await page.evaluate!(cursorVisibilityScript(true));
          }
        },
        move: async (x: number, y: number) => {
          assertOpen();
          await page.mouse.move(x, y, { steps: this.options.mouseMoveSteps ?? 10 });
          await this.updateCursor(page, x, y, false);
        },
        click: async (x: number, y: number) => {
          assertOpen();
          await page.mouse.click(x, y);
          await this.updateCursor(page, x, y, true);
        },
        close: async () => {
          if (sessionClosed) return;
          sessionClosed = true;
          page.off("response", responseListener);
          page.off("requestfailed", requestFailedListener);
          subscribers.clear();
          await context.close();
        },
        subscribeBackendEvents: (listener: (event: BackendEvent) => void) => {
          assertOpen();
          subscribers.add(listener);
          return () => { subscribers.delete(listener); };
        },
      });
    } catch (error) {
      // The listeners are registered before navigation so submissions during page load are observed.
      // Context closure also detaches Playwright listeners when session creation fails.
      await context.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.browserPromise) await (await this.browserPromise).close();
  }

  private browser(): Promise<BrowserPort> {
    this.browserPromise ??= (this.options.launcher ?? defaultLauncher).launch({ headless: this.options.headless ?? true });
    return this.browserPromise;
  }

  private async updateCursor(page: BrowserPagePort, x: number, y: number, clicked: boolean): Promise<void> {
    if (this.options.headless === false && page.evaluate) {
      await page.evaluate(cursorOverlayScript(x, y, clicked));
    }
  }
}
