import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli";

describe("agent harness CLI arguments", () => {
  it("requires exactly one JSON configuration path", () => {
    expect(parseCliArgs(["--config", "runs/dev.json"])).toEqual({ configPath: "runs/dev.json" });
    expect(() => parseCliArgs([])).toThrow("--config");
    expect(() => parseCliArgs(["--config", "a.json", "extra"])).toThrow("Unexpected argument");
  });
});
