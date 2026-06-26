/** Seconds to skip forward or backward for MP3 seek buttons. */
export const SKIP_DURATION = 15;

/**
 * Skip the audio element's currentTime by `offset` seconds,
 * clamped to [0, duration].
 * @param {HTMLAudioElement} player
 * @param {number} offset - positive to skip forward, negative to rewind
 */
export function skipTime(player, offset) {
  const duration = player.duration || Infinity;
  player.currentTime = Math.max(0, Math.min(duration, player.currentTime + offset));
}
