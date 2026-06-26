const { togglePlayPause, rewind, forward, handleEnded } = require('../js/playerControls');

function createMockPlayer(overrides) {
  return {
    paused: true,
    currentTime: 0,
    duration: 300,
    play: jest.fn(),
    pause: jest.fn(),
    classList: { add: jest.fn(), remove: jest.fn() },
    ...overrides,
  };
}

function createMockButton() {
  return {
    innerText: '\u25B6',
    classList: { add: jest.fn(), remove: jest.fn() },
  };
}

describe('togglePlayPause', () => {
  it('plays and updates button when paused', () => {
    const player = createMockPlayer({ paused: true });
    const btn = createMockButton();

    togglePlayPause(player, btn);

    expect(player.play).toHaveBeenCalled();
    expect(btn.innerText).toBe('\u23F8');
    expect(btn.classList.add).toHaveBeenCalledWith('playing');
  });

  it('pauses and updates button when playing', () => {
    const player = createMockPlayer({ paused: false });
    const btn = createMockButton();

    togglePlayPause(player, btn);

    expect(player.pause).toHaveBeenCalled();
    expect(btn.innerText).toBe('\u25B6');
    expect(btn.classList.remove).toHaveBeenCalledWith('playing');
  });
});

describe('rewind', () => {
  it('rewinds by 15 seconds by default', () => {
    const player = createMockPlayer({ currentTime: 60 });
    rewind(player);
    expect(player.currentTime).toBe(45);
  });

  it('rewinds by custom amount', () => {
    const player = createMockPlayer({ currentTime: 60 });
    rewind(player, 30);
    expect(player.currentTime).toBe(30);
  });

  it('does not go below 0', () => {
    const player = createMockPlayer({ currentTime: 5 });
    rewind(player);
    expect(player.currentTime).toBe(0);
  });

  it('clamps to 0 when currentTime is 0', () => {
    const player = createMockPlayer({ currentTime: 0 });
    rewind(player);
    expect(player.currentTime).toBe(0);
  });
});

describe('forward', () => {
  it('forwards by 15 seconds by default', () => {
    const player = createMockPlayer({ currentTime: 60, duration: 300 });
    forward(player);
    expect(player.currentTime).toBe(75);
  });

  it('forwards by custom amount', () => {
    const player = createMockPlayer({ currentTime: 60, duration: 300 });
    forward(player, 30);
    expect(player.currentTime).toBe(90);
  });

  it('does not exceed duration', () => {
    const player = createMockPlayer({ currentTime: 295, duration: 300 });
    forward(player);
    expect(player.currentTime).toBe(300);
  });

  it('handles missing duration gracefully', () => {
    const player = createMockPlayer({ currentTime: 60, duration: undefined });
    forward(player);
    expect(player.currentTime).toBe(75);
  });
});

describe('handleEnded', () => {
  it('resets play button text and seek bar', () => {
    const btn = createMockButton();
    btn.innerText = '\u23F8';
    const seekBar = { value: 75 };

    handleEnded(btn, seekBar);

    expect(btn.innerText).toBe('\u25B6');
    expect(btn.classList.remove).toHaveBeenCalledWith('playing');
    expect(seekBar.value).toBe(0);
  });
});
