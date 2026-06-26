import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createManagedObjectUrl,
  revokeManagedObjectUrl,
} from '../js/utils/object-url.js';

describe('object URL management', () => {
  /** @type {Map<string, Blob>} */
  let blobStore;
  let nextId;

  beforeEach(() => {
    blobStore = new Map();
    nextId = 0;

    vi.stubGlobal('URL', {
      createObjectURL(blob) {
        const id = `blob:mock-${nextId++}`;
        blobStore.set(id, blob);
        return id;
      },
      revokeObjectURL(id) {
        blobStore.delete(id);
      },
    });

    revokeManagedObjectUrl();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an object URL for a blob', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    const url = createManagedObjectUrl(blob);
    expect(url).toMatch(/^blob:mock-/);
    expect(blobStore.get(url)).toBe(blob);
  });

  it('revokes previous URL when creating a new one', () => {
    const blob = new Blob(['a'], { type: 'text/plain' });
    const first = createManagedObjectUrl(blob);
    expect(blobStore.has(first)).toBe(true);

    createManagedObjectUrl(new Blob(['b'], { type: 'text/plain' }));
    expect(blobStore.has(first)).toBe(false);
    expect(blobStore.size).toBe(1);
  });
});
