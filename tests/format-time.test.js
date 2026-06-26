import { describe, it, expect } from 'vitest';
import { formatTime } from '../js/utils/format-time.js';

describe('formatTime', () => {
  it('formats zero seconds', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats single-digit seconds with leading zero', () => {
    expect(formatTime(5)).toBe('0:05');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('formats long durations', () => {
    expect(formatTime(3661)).toBe('61:01');
  });

  it('handles invalid input', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-1)).toBe('0:00');
  });
});
