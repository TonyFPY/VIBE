import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("deployable experiment assets", () => {
  it("keeps the visual-similarity manifest in Vite public data", () => {
    expect(existsSync(resolve(root, "public/data/dreamsim_100/data_100_web.csv"))).toBe(true);
  });

  it("keeps the object-matching manifest in Vite public data", () => {
    expect(existsSync(resolve(root, "public/data/rs_imagenet_100/data_web_100.csv"))).toBe(true);
  });
});
