/**
 * Persistent-storage helpers. Persistent storage tells the browser not to
 * evict IndexedDB data under storage pressure — important on iOS Safari,
 * which otherwise may silently delete the whole library.
 */

/**
 * Ask the browser to mark this origin's storage as persistent.
 * Safe to call repeatedly; resolves false where unsupported or denied.
 * @returns {Promise<boolean>}
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * @typedef {Object} StorageInfo
 * @property {number|null} usage bytes used, null if unknown
 * @property {number|null} quota bytes available, null if unknown
 * @property {boolean|null} persisted null if unknown
 */

/**
 * @returns {Promise<StorageInfo>}
 */
export async function getStorageInfo() {
  const info = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      info.usage = usage ?? null;
      info.quota = quota ?? null;
    }
  } catch {
    // leave nulls
  }
  try {
    if (navigator.storage?.persisted) {
      info.persisted = await navigator.storage.persisted();
    }
  } catch {
    // leave null
  }
  return info;
}

/**
 * @param {number|null} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}
