// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderSaveState, type SaveState } from "./save-status";

function render(state: SaveState): HTMLElement {
  const root = document.createElement("main");
  renderSaveState(root, state);
  return root;
}

describe("save status renderer", () => {
  it("renders saving progress without download actions", () => {
    const root = render({ kind: "saving", attempt: 2, maxAttempts: 3 });

    expect(root.querySelector('[role="status"]')?.textContent).toContain("Saving results");
    expect(root.textContent).toContain("Attempt 2 of 3");
    expect(root.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(root.querySelector("#download-results")).toBeNull();
    expect(root.querySelector("#download-trajectories")).toBeNull();
  });

  it("renders a saved confirmation", () => {
    const root = render({ kind: "saved" });

    expect(root.querySelector('[role="status"]')?.textContent).toContain("Results saved successfully");
    expect(root.querySelector(".vs-save-check")).not.toBeNull();
  });

  it("renders manual downloads when no API is configured", () => {
    const root = render({ kind: "manual", message: "No save API is configured." });

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("No save API is configured.");
    expect(root.querySelector("#download-results")).not.toBeNull();
    expect(root.querySelector("#download-trajectories")).not.toBeNull();
  });

  it("escapes failure messages and keeps recovery actions visible", () => {
    const root = render({ kind: "failed", message: "<SECRET_ANSWER_CANARY>" });

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("<SECRET_ANSWER_CANARY>");
    expect(root.querySelector("[data-message]")?.innerHTML).not.toContain("<SECRET_ANSWER_CANARY>");
    expect(root.querySelectorAll("button")).toHaveLength(2);
  });
});
