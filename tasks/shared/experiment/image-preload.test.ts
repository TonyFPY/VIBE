// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { preloadImage } from "./image-preload";

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn(() => Promise.resolve());
  private source = "";

  constructor() {
    FakeImage.instances.push(this);
  }

  set src(value: string) {
    this.source = value;
  }

  get src(): string {
    return this.source;
  }

  finishLoad(): void {
    this.onload?.();
  }
}

describe("image preloading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeImage.instances = [];
  });

  it("shares one pending image promise for duplicate asset paths", async () => {
    vi.stubGlobal("Image", FakeImage);

    const first = preloadImage("/data/shared.jpg");
    const second = preloadImage("/data/shared.jpg");

    expect(second).toBe(first);
    expect(FakeImage.instances).toHaveLength(1);
    FakeImage.instances[0].finishLoad();
    await expect(first).resolves.toBeUndefined();
    expect(FakeImage.instances[0].decode).toHaveBeenCalledTimes(1);
  });
});
