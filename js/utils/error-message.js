/**
 * Extract a human-readable message from an unknown caught value.
 * @param {unknown} err
 * @returns {string}
 */
export function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
