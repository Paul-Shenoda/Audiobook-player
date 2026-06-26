const fileInput = document.getElementById('audio-upload');
const player = document.getElementById('main-audio');
const playBtn = document.getElementById('play-pause-btn');
const chapterTitle = document.getElementById('Chapter-Title');
const authorName = document.getElementById('Author-Name');

// Track the current object URL so we can revoke it when loading a new file
let currentObjectURL = null;

fileInput.addEventListener('change', function(event){
    //1. Get the selected file
    const file = event.target.files[0];
        //Safety check
    if(!file) return;

    //2. Validate that the file is an audio type
    if (!file.type.startsWith('audio/')) {
        chapterTitle.innerText = "Error: Not an audio file";
        authorName.innerText = "--";
        console.warn('[Audiobook Player] Invalid file type selected:', file.type);
        return;
    }

    //3. Revoke previous object URL to prevent memory leaks
    if (currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
    }

    //4. Create a URL for the file
    currentObjectURL = URL.createObjectURL(file);
    //5. Set the audio player's source to the file URL
    player.src = currentObjectURL;
    //6 Update the text (Temporary)
    chapterTitle.innerText = "Loading Chapter...";
    authorName.innerText = "--";
    //7. Read the ID3 tags
    jsmediatags.read(file, {
        onSuccess: function(tag) {
            chapterTitle.innerText = tag.tags.title || file.name;
            authorName.innerText = tag.tags.artist || "Unknown Artist";
        },
        onError: function(error) {
            console.warn('[Audiobook Player] Could not read ID3 tags:', error.type, error.info);
            chapterTitle.innerText = file.name;
            authorName.innerText = "Unknown Artist";
        }
    });

    //8. Reset play button state
    playBtn.innerText = "▶";
    playBtn.classList.remove('playing');
});

/* HELPER: Format Seconds into MM:SS 
   Input: 3661s -> Output: "61:01"
*/
function formatTime(seconds) {
    // 1. Calculate minutes (drop the decimal part)
    const minutes = Math.floor(seconds / 60);
    
    // 2. Calculate remaining seconds
    const secs = Math.floor(seconds % 60);
    
    // 3. Add a leading zero if seconds are single digit (e.g., "5" becomes "05")
    // "05" vs "5" -> We use a ternary operator here: (condition ? true : false)
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

/* --- CONTROLS LOGIC --- */

// 1. Play / Pause Toggle
playBtn.addEventListener('click', function() {
    // Guard: don't attempt playback if no source is loaded
    if (!player.src || player.src === window.location.href) {
        console.warn('[Audiobook Player] No audio file loaded');
        return;
    }

    // Check if the player is currently paused
    if (player.paused) {
        player.play()
            .then(() => {
                playBtn.innerText = "⏸"; // Change icon to Pause
                playBtn.classList.add('playing');
            })
            .catch((error) => {
                console.error('[Audiobook Player] Playback failed:', error.message);
                chapterTitle.innerText = "Playback failed";
                playBtn.innerText = "▶";
                playBtn.classList.remove('playing');
            });
    } else {
        player.pause();
        playBtn.innerText = "▶";  // Change icon back to Play
        playBtn.classList.remove('playing');
    }
});

// 2. Skip Buttons (Rewind / Forward 15s)
// We defined these IDs in the HTML, now we grab them.
const rewindBtn = document.getElementById('rewind-btn');
const forwardBtn = document.getElementById('forward-btn');

rewindBtn.addEventListener('click', () => {
    if (!player.duration) return; // Guard: no audio loaded
    player.currentTime = Math.max(0, player.currentTime - 15);
});

forwardBtn.addEventListener('click', () => {
    if (!player.duration) return; // Guard: no audio loaded
    player.currentTime = Math.min(player.duration, player.currentTime + 15);
});

/* --- PROGRESS BAR LOGIC --- */
const seekBar = document.getElementById('seek-bar');
const currentTimeText = document.getElementById('current-time');
const durationText = document.getElementById('duration');

// 1. Update the UI as the song plays (The Heartbeat)
player.addEventListener('timeupdate', () => {
    // Avoid "NaN" (Not a Number) errors if nothing is loaded
    if (!player.duration) return;

    // Calculate percentage: (Current Time / Total Duration) * 100
    const value = (player.currentTime / player.duration) * 100;
    
    // Update the slider position
    seekBar.value = value;
    
    // Update the text numbers (using our helper function)
    currentTimeText.innerText = formatTime(player.currentTime);
    durationText.innerText = formatTime(player.duration);
});

// 2. Allow user to drag the slider (Scrubbing)
seekBar.addEventListener('input', () => {
    // Guard: don't seek if no audio is loaded (duration would be NaN)
    if (!player.duration) return;

    // Calculate the new time based on the slider value
    // (Slider Value / 100) * Total Duration
    const newTime = (seekBar.value / 100) * player.duration;
    
    // Tell the player to jump to that time
    player.currentTime = newTime;
});

// 3. Reset when audio ends
player.addEventListener('ended', () => {
    playBtn.innerText = "▶";
    playBtn.classList.remove('playing');
    seekBar.value = 0;
});

/* --- AUDIO ERROR HANDLING --- */

// Listen for errors on the audio element (e.g., corrupt file, unsupported codec)
player.addEventListener('error', function() {
    const error = player.error;
    let message = "Error loading audio";

    if (error) {
        switch (error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
                message = "Playback aborted";
                break;
            case MediaError.MEDIA_ERR_NETWORK:
                message = "Network error while loading audio";
                break;
            case MediaError.MEDIA_ERR_DECODE:
                message = "Error: File could not be decoded";
                break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                message = "Error: Audio format not supported";
                break;
        }
        console.error('[Audiobook Player] Audio error:', error.code, error.message);
    }

    chapterTitle.innerText = message;
    authorName.innerText = "--";
    playBtn.innerText = "▶";
    playBtn.classList.remove('playing');
    seekBar.value = 0;
    currentTimeText.innerText = "0:00";
    durationText.innerText = "0:00";
});