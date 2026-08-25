import { describe, it, expect, vi } from 'vitest';

const { parseBlobMock } = vi.hoisted(() => ({ parseBlobMock: vi.fn() }));
vi.mock('music-metadata', () => ({ parseBlob: parseBlobMock }));

import {
  isDuplicate,
  isAudioFile,
  pictureToBlob,
  naturalSortFiles,
  readM4bChapters,
} from '../js/services/import-service.js';

describe('import-service duplicates', () => {
  it('detects duplicate by name and size (epub-style flat shape)', () => {
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

  it('detects a duplicate against any track of a multi-track mp3 book', () => {
    const existing = [
      {
        type: 'mp3',
        tracks: [
          { sourceFileName: 'ch1.mp3', sourceFileSize: 100 },
          { sourceFileName: 'ch2.mp3', sourceFileSize: 200 },
        ],
      },
    ];
    expect(isDuplicate(existing, { name: 'ch2.mp3', size: 200 })).toBe(true);
    expect(isDuplicate(existing, { name: 'ch3.mp3', size: 300 })).toBe(false);
  });
});

describe('naturalSortFiles', () => {
  it('sorts embedded chapter numbers numerically, not lexicographically', () => {
    const files = [
      { name: 'Chapter 10.mp3' },
      { name: 'Chapter 2.mp3' },
      { name: 'Chapter 1.mp3' },
    ];
    const sorted = naturalSortFiles(files).map((f) => f.name);
    expect(sorted).toEqual(['Chapter 1.mp3', 'Chapter 2.mp3', 'Chapter 10.mp3']);
  });

  it('does not mutate the input array', () => {
    const files = [{ name: 'b.mp3' }, { name: 'a.mp3' }];
    naturalSortFiles(files);
    expect(files.map((f) => f.name)).toEqual(['b.mp3', 'a.mp3']);
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

describe('readM4bChapters', () => {
  it('skips parsing entirely for non-M4B/M4A files', async () => {
    const chapters = await readM4bChapters({ name: 'book.mp3' });
    expect(chapters).toEqual([]);
    expect(parseBlobMock).not.toHaveBeenCalled();
  });

  it('converts start/timeScale to seconds', async () => {
    parseBlobMock.mockResolvedValue({
      format: {
        chapters: [
          { title: 'Chapter One', start: 0, timeScale: 1000 },
          { title: 'Chapter Two', start: 90000, timeScale: 1000 },
        ],
      },
    });
    const chapters = await readM4bChapters({ name: 'book.m4b' });
    expect(chapters).toEqual([
      { title: 'Chapter One', startSeconds: 0 },
      { title: 'Chapter Two', startSeconds: 90 },
    ]);
  });

  it('falls back to raw start when timeScale is absent', async () => {
    parseBlobMock.mockResolvedValue({ format: { chapters: [{ title: 'A', start: 12 }, { title: 'B', start: 34 }] } });
    const chapters = await readM4bChapters({ name: 'book.m4a' });
    expect(chapters.map((c) => c.startSeconds)).toEqual([12, 34]);
  });

  it('treats fewer than 2 chapters as no usable chapter data', async () => {
    parseBlobMock.mockResolvedValue({ format: { chapters: [{ title: 'Only', start: 0, timeScale: 1000 }] } });
    expect(await readM4bChapters({ name: 'book.m4b' })).toEqual([]);
  });

  it('returns [] when the file has no chapters at all', async () => {
    parseBlobMock.mockResolvedValue({ format: {} });
    expect(await readM4bChapters({ name: 'book.m4b' })).toEqual([]);
  });

  it('returns [] instead of throwing when parsing fails', async () => {
    parseBlobMock.mockRejectedValue(new Error('not a valid MP4 container'));
    expect(await readM4bChapters({ name: 'book.m4b' })).toEqual([]);
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
