import { describe, it, expect } from 'vitest';
import { normalizeBook } from '../js/storage/library-db.js';

describe('normalizeBook', () => {
  it('upgrades a legacy single-file mp3 book into a one-entry tracks array', () => {
    const legacy = {
      id: 'b1',
      type: 'mp3',
      title: 'Old Book',
      author: 'Someone',
      fileBlob: new Blob(['audio']),
      sourceFileName: 'old-book.mp3',
      sourceFileSize: 12345,
      progress: { seconds: 42 },
    };

    const normalized = normalizeBook(legacy);

    expect(normalized.tracks).toHaveLength(1);
    expect(normalized.tracks[0]).toMatchObject({
      fileBlob: legacy.fileBlob,
      sourceFileName: 'old-book.mp3',
      sourceFileSize: 12345,
      label: 'Old Book',
    });
    expect(normalized.progress.trackIndex).toBe(0);
    expect(normalized.progress.seconds).toBe(42);
    expect(normalized.bookmarks).toEqual([]);
    expect(normalized.series).toBeNull();
  });

  it('leaves an already-multi-track mp3 book untouched', () => {
    const modern = {
      id: 'b2',
      type: 'mp3',
      title: 'New Book',
      author: 'Someone',
      tracks: [
        { fileBlob: new Blob(['a']), sourceFileName: 'ch1.mp3', sourceFileSize: 1, label: 'Chapter 1' },
        { fileBlob: new Blob(['b']), sourceFileName: 'ch2.mp3', sourceFileSize: 2, label: 'Chapter 2' },
      ],
      progress: { trackIndex: 1, seconds: 10 },
      bookmarks: [{ id: 'bm1', label: 'Great line', createdAt: 1, trackIndex: 0, seconds: 5 }],
      series: { name: 'The Series', position: 2 },
    };

    const normalized = normalizeBook(modern);

    expect(normalized.tracks).toBe(modern.tracks);
    expect(normalized.progress.trackIndex).toBe(1);
    expect(normalized.bookmarks).toEqual(modern.bookmarks);
    expect(normalized.series).toEqual({ name: 'The Series', position: 2 });
  });

  it('does not add tracks/trackIndex to an epub book', () => {
    const epub = {
      id: 'b3',
      type: 'epub',
      title: 'An Epub',
      author: 'Someone',
      fileBlob: new Blob(['epub']),
      progress: { chapterIndex: 2, chunkIndex: 1 },
    };

    const normalized = normalizeBook(epub);

    expect(normalized.tracks).toBeUndefined();
    expect(normalized.progress.trackIndex).toBeUndefined();
    expect(normalized.bookmarks).toEqual([]);
    expect(normalized.series).toBeNull();
  });
});
