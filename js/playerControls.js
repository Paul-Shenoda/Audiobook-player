/**
 * Player controls logic - manages play/pause state, skip, and seek.
 */

function togglePlayPause(player, playBtn) {
  if (player.paused) {
    player.play();
    playBtn.innerText = "\u23F8";
    playBtn.classList.add('playing');
  } else {
    player.pause();
    playBtn.innerText = "\u25B6";
    playBtn.classList.remove('playing');
  }
}

function rewind(player, seconds) {
  if (seconds === undefined) seconds = 15;
  player.currentTime = Math.max(0, player.currentTime - seconds);
}

function forward(player, seconds) {
  if (seconds === undefined) seconds = 15;
  const duration = player.duration || Infinity;
  player.currentTime = Math.min(duration, player.currentTime + seconds);
}

function handleEnded(playBtn, seekBar) {
  playBtn.innerText = "\u25B6";
  playBtn.classList.remove('playing');
  seekBar.value = 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { togglePlayPause, rewind, forward, handleEnded };
}
