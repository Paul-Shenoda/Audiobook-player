const fileInput = document.getElementById('audio-upload');
const player = document.getElementById('main-audio');
const playBtn = document.getElementById('play-pause-btn');
const chapterTitle = document.getElementById('Chapter-Title');
const authorName = document.getElementById('Author-Name');

// Track the current object URL so we can revoke it when a new file is loaded
let currentObjectURL = null;

fileInput.addEventListener('change', function(event){
    //1. Get the selected file
    const file = event.target.files[0];
        //Safety check
    if(!file) return;

    //1.5 Validate file type before processing
    if(!file.type.startsWith('audio/')) {
        chapterTitle.innerText = "Error: Please select an audio file.";
        authorName.innerText = "--";
        return;
    }

    //2. Revoke the previous object URL to prevent memory leaks
    if(currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
    }

    //3. Create a URL for the file
    const fileURL = URL.createObjectURL(file);
    currentObjectURL = fileURL;

    //4. Set the audio player's source to the file URL
    player.src = fileURL;
    //5 Update the text (Temporary)
    chapterTitle.innerText = "Loading Chapter...";
    //6. Read the ID3 tags
    jsmediatags.read(file, {
        onSuccess: function(tag) {
            chapterTitle.innerText = tag.tags.title || file.name;
            authorName.innerText = tag.tags.artist || "Unknown Artist";
        },
        onError: function(error) {
            chapterTitle.innerText = file.name;
        }
    });

    //7. Reset play button
    playBtn.innerText = "▶";
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
    // Check if the player is currently paused
    if (player.paused) {
        player.play();
        playBtn.innerText = "⏸"; // Change icon to Pause
        
        // Add a "glow" class to show it's active (optional style)
        playBtn.classList.add('playing'); 
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
    player.currentTime -= 15; // Go back 15s
});

forwardBtn.addEventListener('click', () => {
    player.currentTime += 15; // Go forward 15s
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
    // Calculate the new time based on the slider value
    // (Slider Value / 100) * Total Duration
    const newTime = (seekBar.value / 100) * player.duration;
    
    // Tell the player to jump to that time
    player.currentTime = newTime;
});

// 3. Reset when audio ends
player.addEventListener('ended', () => {
    playBtn.innerText = "▶";
    seekBar.value = 0;
});