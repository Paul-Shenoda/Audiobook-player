import { describe, it, expect } from 'vitest';
import { htmlToPlainText, chunkText } from '../js/epub/text-extract.js';

describe('htmlToPlainText', () => {
  it('strips HTML tags', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong>.</p>')).toBe('Hello world.');
  });

  it('preserves paragraph breaks', () => {
    const result = htmlToPlainText('<p>First</p><p>Second</p>');
    expect(result).toContain('First');
    expect(result).toContain('Second');
  });

  it('ignores script and style', () => {
    expect(htmlToPlainText('<style>body{}</style><p>Text</p>')).toBe('Text');
  });
});

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('splits long text into chunks', () => {
    const sentence = 'Word. ';
    const long = sentence.repeat(500);
    const chunks = chunkText(long, 200);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(220));
  });
});
