import { describe, it, expect } from 'vitest';
import { isDuplicate, isAudioFile, pictureToBlob } from '../js/services/import-service.js';

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

describe('audio file detection', () => {
  it('accepts mp3, m4b, and m4a by extension', () => {
    expect(isAudioFile({ name: 'book.mp3', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'Book.M4B', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'book.m4a', type: '' })).toBe(true);
  });

  it('accepts unknown extension when MIME type is audio', () => {
    expect(isAudioFile({ name: 'download', type: 'audio/mp4' })).toBe(true);
  });

  it('rejects non-audio files', () => {
    expect(isAudioFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
    expect(isAudioFile({ name: 'book.pdf', type: 'application/pdf' })).toBe(false);
  });
});

describe('pictureToBlob', () => {
  it('converts tag picture bytes to a Blob', () => {
    const blob = pictureToBlob({ format: 'image/png', data: [1, 2, 3] });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('normalizes image/jpg and bare formats', () => {
    expect(pictureToBlob({ format: 'image/jpg', data: [1] }).type).toBe('image/jpeg');
    expect(pictureToBlob({ format: 'png', data: [1] }).type).toBe('image/png');
    expect(pictureToBlob({ data: [1] }).type).toBe('image/jpeg');
  });

  it('returns null when no picture data', () => {
    expect(pictureToBlob(undefined)).toBeNull();
    expect(pictureToBlob({ format: 'image/png', data: [] })).toBeNull();
  });
});
