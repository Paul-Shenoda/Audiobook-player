/**
 * Progress bar logic - computes seek position and updates display.
 */

function computeProgress(currentTime, duration) {
  if (!duration) return 0;
  return (currentTime / duration) * 100;
}

function computeSeekTime(sliderValue, duration) {
  return (sliderValue / 100) * duration;
}

function updateProgressUI(player, seekBar, currentTimeText, durationText, formatTimeFn) {
  if (!player.duration) return;
  const value = computeProgress(player.currentTime, player.duration);
  seekBar.value = value;
  currentTimeText.innerText = formatTimeFn(player.currentTime);
  durationText.innerText = formatTimeFn(player.duration);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeProgress, computeSeekTime, updateProgressUI };
}
