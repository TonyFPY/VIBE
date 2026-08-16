export type SaveState =
  | { kind: "saving"; attempt: number; maxAttempts: number }
  | { kind: "saved" }
  | { kind: "manual" | "failed"; message: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function renderSaveState(root: HTMLElement, state: SaveState): void {
  if (state.kind === "saving") {
    root.innerHTML = `<section class="vs-save-panel vs-save-saving" role="status" aria-live="polite" aria-busy="true">
      <div class="vs-save-spinner" aria-hidden="true"></div>
      <p class="vs-eyebrow">Finalizing</p>
      <h1>Saving results…</h1>
      <p>Attempt ${state.attempt} of ${state.maxAttempts}. Please do not close this window.</p>
    </section>`;
    return;
  }

  if (state.kind === "saved") {
    root.innerHTML = `<section class="vs-save-panel vs-save-saved" role="status" aria-live="polite">
      <div class="vs-save-check" aria-hidden="true">✓</div>
      <p class="vs-eyebrow">Complete</p>
      <h1>Results saved successfully.</h1>
      <p>This window will close automatically.</p>
    </section>`;
    return;
  }

  const title = state.kind === "manual" ? "Download your results" : "Save incomplete";
  root.innerHTML = `<section class="vs-save-panel vs-save-${state.kind}" role="alert">
    <p class="vs-eyebrow">${state.kind === "manual" ? "Manual save required" : "Automatic save failed"}</p>
    <h1>${title}</h1>
    <p data-message>${escapeHtml(state.message)}</p>
    <div class="vs-actions">
      <button id="download-results" class="vs-primary" type="button">Download results</button>
      <button id="download-trajectories" class="vs-secondary" type="button">Download trajectories</button>
    </div>
  </section>`;
}
