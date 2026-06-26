/**
 * File handling logic - processes file selection and metadata extraction.
 */

function handleFileSelect(file, player, chapterTitle, authorName, playBtn, readTags) {
  if (!file) return null;

  const fileURL = URL.createObjectURL(file);
  player.src = fileURL;
  chapterTitle.innerText = "Loading Chapter...";
  playBtn.innerText = "\u25B6";

  if (readTags) {
    readTags(file, {
      onSuccess: function (tag) {
        chapterTitle.innerText = tag.tags.title || file.name;
        authorName.innerText = tag.tags.artist || "Unknown Artist";
      },
      onError: function () {
        chapterTitle.innerText = file.name;
      }
    });
  }

  return fileURL;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleFileSelect };
}
