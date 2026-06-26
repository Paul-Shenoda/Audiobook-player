const { handleFileSelect } = require('../js/fileHandler');

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:http://localhost/fake-url');

describe('handleFileSelect', () => {
  let player, chapterTitle, authorName, playBtn;

  beforeEach(() => {
    player = { src: '' };
    chapterTitle = { innerText: '' };
    authorName = { innerText: '' };
    playBtn = { innerText: '' };
  });

  it('returns null when file is null', () => {
    const result = handleFileSelect(null, player, chapterTitle, authorName, playBtn, null);
    expect(result).toBeNull();
  });

  it('returns null when file is undefined', () => {
    const result = handleFileSelect(undefined, player, chapterTitle, authorName, playBtn, null);
    expect(result).toBeNull();
  });

  it('sets player source to object URL', () => {
    const file = { name: 'chapter1.mp3' };
    handleFileSelect(file, player, chapterTitle, authorName, playBtn, null);

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(player.src).toBe('blob:http://localhost/fake-url');
  });

  it('sets loading text while processing', () => {
    const file = { name: 'chapter1.mp3' };
    handleFileSelect(file, player, chapterTitle, authorName, playBtn, null);

    expect(chapterTitle.innerText).toBe('Loading Chapter...');
  });

  it('sets play button to play icon', () => {
    const file = { name: 'chapter1.mp3' };
    handleFileSelect(file, player, chapterTitle, authorName, playBtn, null);

    expect(playBtn.innerText).toBe('\u25B6');
  });

  it('returns the created object URL', () => {
    const file = { name: 'chapter1.mp3' };
    const result = handleFileSelect(file, player, chapterTitle, authorName, playBtn, null);

    expect(result).toBe('blob:http://localhost/fake-url');
  });

  it('calls readTags with file and callbacks when provided', () => {
    const file = { name: 'chapter1.mp3' };
    const mockReadTags = jest.fn();

    handleFileSelect(file, player, chapterTitle, authorName, playBtn, mockReadTags);

    expect(mockReadTags).toHaveBeenCalledWith(file, expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }));
  });

  it('onSuccess callback sets title from tag', () => {
    const file = { name: 'chapter1.mp3' };
    const mockReadTags = jest.fn();

    handleFileSelect(file, player, chapterTitle, authorName, playBtn, mockReadTags);

    const callbacks = mockReadTags.mock.calls[0][1];
    callbacks.onSuccess({ tags: { title: 'My Chapter', artist: 'Author Name' } });

    expect(chapterTitle.innerText).toBe('My Chapter');
    expect(authorName.innerText).toBe('Author Name');
  });

  it('onSuccess callback falls back to file name when title is missing', () => {
    const file = { name: 'chapter1.mp3' };
    const mockReadTags = jest.fn();

    handleFileSelect(file, player, chapterTitle, authorName, playBtn, mockReadTags);

    const callbacks = mockReadTags.mock.calls[0][1];
    callbacks.onSuccess({ tags: {} });

    expect(chapterTitle.innerText).toBe('chapter1.mp3');
    expect(authorName.innerText).toBe('Unknown Artist');
  });

  it('onError callback sets chapter title to file name', () => {
    const file = { name: 'chapter1.mp3' };
    const mockReadTags = jest.fn();

    handleFileSelect(file, player, chapterTitle, authorName, playBtn, mockReadTags);

    const callbacks = mockReadTags.mock.calls[0][1];
    callbacks.onError(new Error('parse failed'));

    expect(chapterTitle.innerText).toBe('chapter1.mp3');
  });
});
