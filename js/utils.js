/* --- Shared Utilities for Audiobook Player --- */

const SKIP_DURATION = 15; // seconds to skip forward/backward

const ICONS = {
    play: "▶",
    pause: "⏸"
};

/**
 * Format seconds into MM:SS string.
 * Example: 3661 -> "61:01"
 */
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Set the play/pause button to reflect current playback state.
 * Consolidates icon text and CSS class toggling in one place.
 */
function setPlayState(playBtn, isPlaying) {
    playBtn.innerText = isPlaying ? ICONS.pause : ICONS.play;
    playBtn.classList.toggle('playing', isPlaying);
}

/**
 * Update the metadata display (title + author).
 * Falls back to provided defaults when tags are missing.
 */
function updateMetadata(elements, title, author) {
    elements.chapterTitle.innerText = title || "Unknown Title";
    elements.authorName.innerText = author || "Unknown Artist";
}

/**
 * Skip the player's current time by a given offset (positive or negative).
 */
function skipTime(player, offset) {
    player.currentTime += offset;
}

/**
 * Collect all DOM element references in one place.
 * Avoids scattered getElementById calls throughout the app.
 */
function getPlayerElements() {
    return {
        fileInput: document.getElementById('audio-upload'),
        player: document.getElementById('main-audio'),
        playBtn: document.getElementById('play-pause-btn'),
        chapterTitle: document.getElementById('Chapter-Title'),
        authorName: document.getElementById('Author-Name'),
        rewindBtn: document.getElementById('rewind-btn'),
        forwardBtn: document.getElementById('forward-btn'),
        seekBar: document.getElementById('seek-bar'),
        currentTimeText: document.getElementById('current-time'),
        durationText: document.getElementById('duration')
    };
}
