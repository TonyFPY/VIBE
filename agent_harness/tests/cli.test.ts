import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli";

describe("agent harness CLI arguments", () => {
  it("requires exactly one JSON configuration path", () => {
    expect(parseCliArgs(["--config", "runs/dev.json"])).toEqual({ configPath: "runs/dev.json", headed: false });
    expect(() => parseCliArgs([])).toThrow("--config");
    expect(() => parseCliArgs(["--config", "a.json", "extra"])).toThrow("Unexpected argument");
  });

  it("accepts headed mode exactly once", () => {
    expect(parseCliArgs(["--config", "runs/dev.json", "--headed"])).toEqual({
      configPath: "runs/dev.json",
      headed: true,
    });
    expect(() => parseCliArgs(["--config", "runs/dev.json", "--headed", "--headed"])).toThrow("--headed may be supplied only once");
    expect(() => parseCliArgs(["--config", "runs/dev.json", "--show-gui"])).toThrow("Unexpected argument");
  });
});
