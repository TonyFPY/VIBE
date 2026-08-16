// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "../experiment/types";
import { finishSession } from "./save-flow";

const payload = (): SessionPayload => ({
  session: {
    sessionId: "flow-session",
    participantId: "001",
    participantType: "human",
    model: "None",
    runMode: "dev",
  },
  results: [],
  trajectories: [],
});

function setup() {
  const root = document.createElement("main");
  const download = vi.fn();
  const checkpoint = vi.fn();
  const clearRecovery = vi.fn();
  return { root, download, checkpoint, clearRecovery };
}

describe("finishSession", () => {
  it("shows manual downloads without calling submit when no endpoint exists", async () => {
    const dependencies = setup();
    const submit = vi.fn();

    await expect(finishSession({ ...dependencies, payload: payload(), endpoint: undefined, submit })).resolves.toBe("manual");

    expect(submit).not.toHaveBeenCalled();
    expect(dependencies.checkpoint).toHaveBeenCalledTimes(1);
    expect(dependencies.root.textContent).toContain("Manual save required");
    expect(dependencies.root.querySelector("#download-results")).not.toBeNull();
    expect(dependencies.clearRecovery).not.toHaveBeenCalled();
  });

  it("clears recovery only after a successful API save", async () => {
    const dependencies = setup();
    const submit = vi.fn().mockResolvedValue(undefined);

    await expect(finishSession({ ...dependencies, payload: payload(), endpoint: "https://api.example.test/sessions", submit })).resolves.toBe("saved");

    expect(submit).toHaveBeenCalledTimes(1);
    expect(dependencies.clearRecovery).toHaveBeenCalledWith("flow-session");
    expect(dependencies.root.textContent).toContain("Results saved successfully");
  });

  it("retains recovery and exposes both downloads after API failure", async () => {
    const dependencies = setup();
    const submit = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(finishSession({ ...dependencies, payload: payload(), endpoint: "https://api.example.test/sessions", submit })).resolves.toBe("failed");

    expect(dependencies.clearRecovery).not.toHaveBeenCalled();
    expect(dependencies.root.textContent).toContain("Automatic save failed");
    expect(dependencies.root.querySelectorAll("button")).toHaveLength(2);
  });
});
