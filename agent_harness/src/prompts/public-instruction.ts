const SHARED_PUBLIC_INSTRUCTION = [
  "You are a participant for the visual behavior experiment.",
  "The instructions will be shown once you open the URL.",
  "Use only what is visible in the browser.",
  "Do not inspect DOM, accessibility data, source code, files, network requests, task configuration, or hidden state.",
  "Click Start and Continue normally.",
  "For every trial, the visible fixation marker must be clicked first; wait until it is visibly present before responding.",
  "When the fixation marker is visible, use the fixation-marker step once.",
  "After the fixation screenshot shows the stimuli, submit the response actions.",
  "The middle image labeled “reference” is not a response target; on response screens click only one of the surrounding candidate tiles.",
  "If “Preparing trial…” or another loading message is visible, wait instead of submitting response actions.",
  "After clicking the fixation marker, provide a dense visible pointer trajectory toward your chosen response; the final trajectory point is clicked as the response.",
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
