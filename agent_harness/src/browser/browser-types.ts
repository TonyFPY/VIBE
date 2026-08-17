export interface BrowserMousePort {
  move(x: number, y: number, options?: { steps: number }): Promise<void>;
  click(x: number, y: number): Promise<void>;
}

export interface BrowserRequestFailurePort {
  method(): string;
  url(): string;
  failure(): { errorText: string } | null;
}

export interface BrowserResponsePort {
  request(): BrowserRequestFailurePort;
  status(): number;
  ok(): boolean;
}

export interface BrowserPagePort {
  readonly mouse: BrowserMousePort;
  on(event: "response", listener: (response: BrowserResponsePort) => void): void;
  on(event: "requestfailed", listener: (request: BrowserRequestFailurePort) => void): void;
  off(event: "response", listener: (response: BrowserResponsePort) => void): void;
  off(event: "requestfailed", listener: (request: BrowserRequestFailurePort) => void): void;
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  /** Optional controller-only overlay hook; never exposed to the model. */
  evaluate?(expression: string): Promise<unknown>;
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
  subscribeBackendEvents(listener: (event: BackendEvent) => void): () => void;
  close(): Promise<void>;
}

export type BackendEvent =
  | { type: "results-response"; status: number; ok: boolean }
  | { type: "results-request-failed"; error: string };

export interface BrowserHost {
  openSession(
    url: string,
    viewport: { width: 1080; height: 675 },
  ): Promise<BrowserSession>;
  close(): Promise<void>;
}
