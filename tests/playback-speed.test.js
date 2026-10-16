import { describe, it, expect } from 'vitest';
import { SPEED_STEPS, stepSpeed, clampSpeed } from '../js/utils/playback-speed.js';

describe('playback speed steps', () => {
  it('offers 0.5x to 3x', () => {
    expect(SPEED_STEPS[0]).toBe(0.5);
    expect(SPEED_STEPS.at(-1)).toBe(3);
    expect(SPEED_STEPS).toContain(1);
  });

  it('steps up and down one notch', () => {
    expect(stepSpeed(1, +1)).toBe(1.25);
    expect(stepSpeed(1.25, -1)).toBe(1);
  });

  it('stops at both ends', () => {
    expect(stepSpeed(3, +1)).toBe(3);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
  });

  it('snaps an off-grid or missing rate to the nearest step', () => {
    expect(clampSpeed(1.1)).toBe(1);
    expect(clampSpeed(9)).toBe(3);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });

  it('steps from an off-grid rate via its nearest step', () => {
    expect(stepSpeed(1.1, +1)).toBe(1.25);
  });

  it('respects a lower maximum (EPUB / Web Speech stops at 2x)', () => {
    expect(stepSpeed(2, +1, 2)).toBe(2);
    expect(stepSpeed(1.75, +1, 2)).toBe(2);
    expect(clampSpeed(3, 2)).toBe(2);
    expect(clampSpeed(1.5, 2)).toBe(1.5);
  });
});
