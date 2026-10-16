/** Speeds offered by both players (audio files and EPUB listen mode). */
export const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/**
 * Nearest offered speed; 1× for anything missing or invalid.
 * @param {number | undefined} rate
 */
export function clampSpeed(rate) {
  if (!Number.isFinite(rate)) return 1;
  return SPEED_STEPS.reduce((best, step) => (Math.abs(step - rate) < Math.abs(best - rate) ? step : best));
}

/**
 * One notch faster (+1) or slower (-1), stopping at both ends.
 * @param {number} rate
 * @param {1 | -1} direction
 */
export function stepSpeed(rate, direction) {
  const index = SPEED_STEPS.indexOf(clampSpeed(rate));
  return SPEED_STEPS[Math.min(Math.max(index + direction, 0), SPEED_STEPS.length - 1)];
}
