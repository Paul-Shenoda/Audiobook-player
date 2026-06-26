const { computeProgress, computeSeekTime, updateProgressUI } = require('../js/progressBar');

describe('computeProgress', () => {
  it('returns 0 when duration is 0', () => {
    expect(computeProgress(50, 0)).toBe(0);
  });

  it('returns 0 when duration is falsy', () => {
    expect(computeProgress(50, null)).toBe(0);
    expect(computeProgress(50, undefined)).toBe(0);
    expect(computeProgress(50, NaN)).toBe(0);
  });

  it('calculates percentage correctly', () => {
    expect(computeProgress(50, 100)).toBe(50);
    expect(computeProgress(25, 100)).toBe(25);
    expect(computeProgress(100, 100)).toBe(100);
  });

  it('handles fractional values', () => {
    expect(computeProgress(1, 3)).toBeCloseTo(33.33, 1);
  });

  it('returns 0 when currentTime is 0', () => {
    expect(computeProgress(0, 300)).toBe(0);
  });
});

describe('computeSeekTime', () => {
  it('converts slider value to time', () => {
    expect(computeSeekTime(50, 200)).toBe(100);
    expect(computeSeekTime(0, 200)).toBe(0);
    expect(computeSeekTime(100, 200)).toBe(200);
  });

  it('handles fractional slider values', () => {
    expect(computeSeekTime(33.33, 300)).toBeCloseTo(99.99, 1);
  });

  it('returns 0 when slider is at 0', () => {
    expect(computeSeekTime(0, 600)).toBe(0);
  });
});

describe('updateProgressUI', () => {
  it('updates seek bar and time displays', () => {
    const player = { currentTime: 60, duration: 120 };
    const seekBar = { value: 0 };
    const currentTimeText = { innerText: '' };
    const durationText = { innerText: '' };
    const mockFormat = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    updateProgressUI(player, seekBar, currentTimeText, durationText, mockFormat);

    expect(seekBar.value).toBe(50);
    expect(currentTimeText.innerText).toBe('1:00');
    expect(durationText.innerText).toBe('2:00');
  });

  it('does nothing when duration is 0', () => {
    const player = { currentTime: 10, duration: 0 };
    const seekBar = { value: 25 };
    const currentTimeText = { innerText: 'old' };
    const durationText = { innerText: 'old' };
    const mockFormat = jest.fn();

    updateProgressUI(player, seekBar, currentTimeText, durationText, mockFormat);

    expect(seekBar.value).toBe(25);
    expect(currentTimeText.innerText).toBe('old');
    expect(mockFormat).not.toHaveBeenCalled();
  });

  it('does nothing when duration is NaN', () => {
    const player = { currentTime: 10, duration: NaN };
    const seekBar = { value: 25 };
    const currentTimeText = { innerText: 'old' };
    const durationText = { innerText: 'old' };
    const mockFormat = jest.fn();

    updateProgressUI(player, seekBar, currentTimeText, durationText, mockFormat);

    expect(seekBar.value).toBe(25);
    expect(mockFormat).not.toHaveBeenCalled();
  });
});
