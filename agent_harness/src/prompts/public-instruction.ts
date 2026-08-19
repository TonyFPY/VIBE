const SHARED_PUBLIC_INSTRUCTION = [
  "You are a participant for the visual behavior experiment.",
  "The instructions will be shown once you open the URL.",
  "Use only what is visible in the browser.",
  "Do not inspect DOM, accessibility data, source code, files, network requests, task configuration, or hidden state.",
  "Click Start and Continue normally.",
  "For every trial, click the center cross first.",
  "After clicking the cross, move the cursor toward your chosen response through multiple small visible movements, then click the response.",
  "Do not jump directly from the center cross to a candidate with one direct click.",
  "If “Save incomplete” appears, click `Download results`, then `Download trajectories`, and stop.",
  "If “Results saved successfully” appears, do not click a download button: the API already saved both files. Stop.",
].join(" ");

const instructions: Readonly<Record<string, string>> = {
  "/tasks/visual-similarity": SHARED_PUBLIC_INSTRUCTION,
  "/tasks/object-matching": SHARED_PUBLIC_INSTRUCTION,
};

export function publicInstructionForTask(taskUrl: string): string {
  const pathname = new URL(taskUrl).pathname.replace(/\/$/, "");
  const instruction = instructions[pathname];
  if (!instruction) throw new Error(`Unsupported task route: ${pathname}`);
  return instruction;
}
