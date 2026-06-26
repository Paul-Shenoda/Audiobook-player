import { describe, it, expect } from 'vitest';
import { hashHue, getInitials } from '../js/utils/cover-fallback.js';

describe('cover-fallback', () => {
  it('returns stable hue for same title', () => {
    expect(hashHue('Dune')).toBe(hashHue('Dune'));
  });

  it('returns different hues for different titles', () => {
    expect(hashHue('A')).not.toBe(hashHue('B'));
  });

  it('extracts initials from title', () => {
    expect(getInitials('The Great Gatsby')).toBe('TG');
    expect(getInitials('Dune')).toBe('DU');
    expect(getInitials('')).toBe('?');
  });
});
