import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("hosting configuration", () => {
  it("defines Firebase task routing", () => {
    const config = readFileSync(resolve(root, "firebase.json"), "utf8");
    expect(config).toContain('"source": "/tasks/**"');
    expect(config).toContain('"destination": "/index.html"');
  });

  it("ships Netlify, Vercel, and Cloudflare task fallbacks", () => {
    expect(readFileSync(resolve(root, "netlify.toml"), "utf8")).toContain('from = "/tasks/*"');
    expect(readFileSync(resolve(root, "vercel.json"), "utf8")).toContain('"source": "/tasks/(.*)"');
    expect(readFileSync(resolve(root, "public/_redirects"), "utf8")).toContain("/tasks/* /index.html 200");
  });
});
