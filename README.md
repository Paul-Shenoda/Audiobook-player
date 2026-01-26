# 🎧 Simple Local Audiobook Player

A lightweight, client-side web application that plays local MP3 files directly in the browser. Designed for mobile usage, it parses ID3 tags to display chapter metadata and persists no data to external servers.

## 🚀 Features
* **Local File Parsing:** Loads audio files directly from the device storage without uploading them to a cloud server.
* **Metadata Extraction:** Uses `jsmediatags` to read ID3 tags (Title, Artist) from binary MP3 data.
* **Custom Controls:** Custom-built interface for Play/Pause, Seek (±15s), and Scrubbing.
* **Marquee Text:** Auto-scrolling title display for long chapter names.
* **Mobile First:** Responsive CSS design with touch-friendly targets and dark mode.

## 🛠️ Tech Stack
* **HTML5:** Audio API & Semantic Structure
* **CSS3:** Flexbox, CSS Variables, & Keyframe Animations
* **JavaScript (ES6):** DOM Manipulation & Event Handling
* **Library:** [jsmediatags](https://github.com/aadsm/jsmediatags) (via CDN)

## 📦 How to Run
1.  Clone this repository.
2.  Open the folder in VS Code.
3.  Use **Live Server** extension to launch `index.html`.
4.  *Note:* Simply double-clicking the HTML file may block the script due to browser CORS policies; a local server is required.

## 📱 How to Use
1.  Click "📂 Load MP3 File".
2.  Select an audiobook file from your device.
3.  Use the controls to play, pause, or skip.