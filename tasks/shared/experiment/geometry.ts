export const TRIAL_CANVAS = { width: 1080, height: 675 } as const;

export interface TrialArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const isTrialViewportSupported = (viewport: { width: number; height: number }) => (
  viewport.width >= TRIAL_CANVAS.width && viewport.height >= TRIAL_CANVAS.height
);

export const calculateReactionTimeMs = (crossClickedAt: number, responseAt: number) => (
  responseAt - crossClickedAt
);

export function normalizePointer(point: { x: number; y: number }, area: TrialArea) {
  const centerX = area.left + area.width / 2;
  const centerY = area.top + area.height / 2;
  return {
    xRaw: point.x,
    yRaw: point.y,
    xNorm: (point.x - area.left) / area.width,
    yNorm: (point.y - area.top) / area.height,
    xCentered: (point.x - centerX) / area.width,
    yCentered: (point.y - centerY) / area.height,
  };
}
