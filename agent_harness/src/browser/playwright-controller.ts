import { chromium } from "playwright";

import type {
  BrowserHost,
  BrowserLauncherPort,
  BrowserPort,
  BrowserSession,
} from "./browser-types";

export interface PlaywrightBrowserHostOptions {
  launcher?: BrowserLauncherPort;
  headless?: boolean;
  settleDelayMs: number;
  navigationTimeoutMs: number;
}

const defaultLauncher: BrowserLauncherPort = {
  launch: async (options) => chromium.launch(options) as Promise<BrowserPort>,
};

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

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
      await page.goto(url, { waitUntil: "load", timeout: this.options.navigationTimeoutMs });
      await wait(this.options.settleDelayMs);
      let sessionClosed = false;
      const assertOpen = () => {
        if (sessionClosed) throw new Error("Browser session is closed");
      };
      return Object.freeze({
        screenshot: async (quality: number) => {
          assertOpen();
          return page.screenshot({ type: "jpeg", quality });
        },
        move: async (x: number, y: number) => {
          assertOpen();
          await page.mouse.move(x, y);
        },
        click: async (x: number, y: number) => {
          assertOpen();
          await page.mouse.click(x, y);
        },
        close: async () => {
          if (sessionClosed) return;
          sessionClosed = true;
          await context.close();
        },
      });
    } catch (error) {
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
}
