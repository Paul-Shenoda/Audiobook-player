/** Speeds offered by the players. EPUB listen mode stops at 2× (see EPUB_MAX_SPEED). */
export const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Web Speech voices get hard to follow above 2×, especially on iOS. */
export const EPUB_MAX_SPEED = 2;

const stepsUpTo = (max) => SPEED_STEPS.filter((step) => step <= max);

/**
 * Nearest offered speed (up to `max`); 1× for anything missing or invalid.
 * @param {number | undefined} rate
 * @param {number} [max]
 */
export function clampSpeed(rate, max = 3) {
  if (!Number.isFinite(rate)) return 1;
  return stepsUpTo(max).reduce((best, step) => (Math.abs(step - rate) < Math.abs(best - rate) ? step : best));
}

/**
 * One notch faster (+1) or slower (-1), stopping at both ends.
 * @param {number} rate
 * @param {1 | -1} direction
 * @param {number} [max]
 */
export function stepSpeed(rate, direction, max = 3) {
  const steps = stepsUpTo(max);
  const index = steps.indexOf(clampSpeed(rate, max));
  return steps[Math.min(Math.max(index + direction, 0), steps.length - 1)];
}
