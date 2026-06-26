let currentObjectUrl = null;

/**
 * Create an object URL, revoking any previous one to avoid leaks.
 * @param {Blob|File} blob
 * @returns {string}
 */
export function createManagedObjectUrl(blob) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = URL.createObjectURL(blob);
  return currentObjectUrl;
}

/**
 * Revoke the currently managed object URL, if any.
 */
export function revokeManagedObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}
