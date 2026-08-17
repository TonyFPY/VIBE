export interface BrowserMousePort {
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
}

export interface BrowserPagePort {
  readonly mouse: BrowserMousePort;
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  screenshot(options: { type: "jpeg"; quality: number }): Promise<Uint8Array>;
}

export interface BrowserContextPort {
  newPage(): Promise<BrowserPagePort>;
  close(): Promise<void>;
}

export interface BrowserPort {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: 1;
  }): Promise<BrowserContextPort>;
  close(): Promise<void>;
}

export interface BrowserLauncherPort {
  launch(options: { headless: boolean }): Promise<BrowserPort>;
}

export interface BrowserSession {
  screenshot(quality: number): Promise<Uint8Array>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserHost {
  openSession(
    url: string,
    viewport: { width: 1080; height: 675 },
  ): Promise<BrowserSession>;
  close(): Promise<void>;
}
