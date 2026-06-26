/* --- Audiobook Player Application --- */

// Centralized DOM references (from utils.js)
const el = getPlayerElements();

// --- FILE LOADING ---
el.fileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileURL = URL.createObjectURL(file);
    el.player.src = fileURL;

    updateMetadata(el, "Loading Chapter...", "--");

    jsmediatags.read(file, {
        onSuccess: function(tag) {
            updateMetadata(el, tag.tags.title || file.name, tag.tags.artist);
        },
        onError: function() {
            updateMetadata(el, file.name, "Unknown Artist");
        }
    });

    setPlayState(el.playBtn, false);
});

// --- CONTROLS LOGIC ---

// Play / Pause Toggle
el.playBtn.addEventListener('click', function() {
    if (el.player.paused) {
        el.player.play();
    } else {
        el.player.pause();
    }
    setPlayState(el.playBtn, !el.player.paused);
});

// Skip Buttons (Rewind / Forward)
el.rewindBtn.addEventListener('click', () => {
    skipTime(el.player, -SKIP_DURATION);
});

el.forwardBtn.addEventListener('click', () => {
    skipTime(el.player, SKIP_DURATION);
});

// --- PROGRESS BAR LOGIC ---

// Update the UI as the audio plays
el.player.addEventListener('timeupdate', () => {
    if (!el.player.duration) return;

    const progress = (el.player.currentTime / el.player.duration) * 100;
    el.seekBar.value = progress;

    el.currentTimeText.innerText = formatTime(el.player.currentTime);
    el.durationText.innerText = formatTime(el.player.duration);
});

// Allow user to drag the slider (Scrubbing)
el.seekBar.addEventListener('input', () => {
    const newTime = (el.seekBar.value / 100) * el.player.duration;
    el.player.currentTime = newTime;
});

// Reset when audio ends
el.player.addEventListener('ended', () => {
    setPlayState(el.playBtn, false);
    el.seekBar.value = 0;
});
