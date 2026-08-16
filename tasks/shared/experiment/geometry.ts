export const TRIAL_CANVAS = { width: 1080, height: 675 } as const;

export const isTrialViewportSupported = (viewport: { width: number; height: number }) => (
  viewport.width >= TRIAL_CANVAS.width && viewport.height >= TRIAL_CANVAS.height
);

export const calculateReactionTimeMs = (crossClickedAt: number, responseAt: number) => (
  responseAt - crossClickedAt
);

export type PointerTuple = [elapsedMs: number, xPx: number, yPx: number];

export function pointerTupleAtCross(
  point: { x: number; y: number },
  crossClick: { x: number; y: number },
  elapsedMs: number,
): PointerTuple {
  return [
    Math.round(elapsedMs),
    Math.round(point.x - crossClick.x),
    Math.round(point.y - crossClick.y),
  ];
}

export function shouldSamplePointer(previous: PointerTuple, next: PointerTuple): boolean {
  const elapsedMs = next[0] - previous[0];
  const distancePx = Math.hypot(next[1] - previous[1], next[2] - previous[2]);
  return elapsedMs >= 16 && distancePx >= 2;
}
