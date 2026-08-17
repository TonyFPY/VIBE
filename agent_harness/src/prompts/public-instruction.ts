const instructions: Readonly<Record<string, string>> = {
  "/tasks/visual-similarity": "Complete the visual similarity experiment using only what is visible. Start or continue when prompted. Choose the candidate most visually similar to the reference after each trial is revealed. Return DONE only when the visible page says the experiment is complete.",
  "/tasks/object-matching": "Complete the object matching experiment using only what is visible. Start or continue when prompted. Choose the candidate object that belongs with the reference after each trial is revealed. Return DONE only when the visible page says the experiment is complete.",
};

export function publicInstructionForTask(taskUrl: string): string {
  const pathname = new URL(taskUrl).pathname.replace(/\/$/, "");
  const instruction = instructions[pathname];
  if (!instruction) throw new Error(`Unsupported task route: ${pathname}`);
  return instruction;
}
