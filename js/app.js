/* global jsmediatags, formatTime, togglePlayPause, rewind, forward, handleEnded,
   computeSeekTime, updateProgressUI, handleFileSelect */

const fileInput = document.getElementById('audio-upload');
const player = document.getElementById('main-audio');
const playBtn = document.getElementById('play-pause-btn');
const chapterTitle = document.getElementById('Chapter-Title');
const authorName = document.getElementById('Author-Name');

fileInput.addEventListener('change', function(event){
    const file = event.target.files[0];
    handleFileSelect(file, player, chapterTitle, authorName, playBtn, jsmediatags.read.bind(jsmediatags));
});

/* --- CONTROLS LOGIC --- */

playBtn.addEventListener('click', function() {
    togglePlayPause(player, playBtn);
});

const rewindBtn = document.getElementById('rewind-btn');
const forwardBtn = document.getElementById('forward-btn');

rewindBtn.addEventListener('click', () => {
    rewind(player);
});

forwardBtn.addEventListener('click', () => {
    forward(player);
});

/* --- PROGRESS BAR LOGIC --- */
const seekBar = document.getElementById('seek-bar');
const currentTimeText = document.getElementById('current-time');
const durationText = document.getElementById('duration');

player.addEventListener('timeupdate', () => {
    updateProgressUI(player, seekBar, currentTimeText, durationText, formatTime);
});

seekBar.addEventListener('input', () => {
    const newTime = computeSeekTime(seekBar.value, player.duration);
    player.currentTime = newTime;
});

player.addEventListener('ended', () => {
    handleEnded(playBtn, seekBar);
});
