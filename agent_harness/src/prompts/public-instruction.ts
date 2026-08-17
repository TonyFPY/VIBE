const instructions: Readonly<Record<string, string>> = {
  "/tasks/visual-similarity": "Complete the visual similarity experiment using only what is visible on the screen. Start or continue when the page prompts you. After each trial is revealed, choose the visible candidate most visually similar to the reference. Keep acting until the page visibly reaches the saved or successfully completed state.",
  "/tasks/object-matching": "Complete the object matching experiment using only what is visible on the screen. Start or continue when the page prompts you. After each trial is revealed, choose the visible candidate object that belongs with the reference. Keep acting until the page visibly reaches the saved or successfully completed state.",
};

export function publicInstructionForTask(taskUrl: string): string {
  const pathname = new URL(taskUrl).pathname.replace(/\/$/, "");
  const instruction = instructions[pathname];
  if (!instruction) throw new Error(`Unsupported task route: ${pathname}`);
  return instruction;
}
