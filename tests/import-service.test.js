import { describe, it, expect } from 'vitest';
import { isDuplicate } from '../js/services/import-service.js';

describe('import-service duplicates', () => {
  it('detects duplicate by name and size', () => {
    const existing = [
      { sourceFileName: 'book.epub', sourceFileSize: 1024 },
    ];
    const file = { name: 'book.epub', size: 1024 };
    expect(isDuplicate(existing, file)).toBe(true);
  });

  it('allows different size same name', () => {
    const existing = [
      { sourceFileName: 'book.epub', sourceFileSize: 1024 },
    ];
    const file = { name: 'book.epub', size: 2048 };
    expect(isDuplicate(existing, file)).toBe(false);
  });
});
