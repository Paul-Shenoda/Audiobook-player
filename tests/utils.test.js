const { formatTime } = require('../js/utils');

describe('formatTime', () => {
  it('formats zero seconds as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds less than 60 with leading zero', () => {
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(9)).toBe('0:09');
  });

  it('formats exact minutes', () => {
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(120)).toBe('2:00');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(61)).toBe('1:01');
    expect(formatTime(125)).toBe('2:05');
  });

  it('handles large values (over 60 minutes)', () => {
    expect(formatTime(3661)).toBe('61:01');
    expect(formatTime(7200)).toBe('120:00');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(1.9)).toBe('0:01');
    expect(formatTime(59.99)).toBe('0:59');
    expect(formatTime(60.5)).toBe('1:00');
  });

  it('handles NaN gracefully', () => {
    const result = formatTime(NaN);
    expect(result).toBe('NaN:NaN');
  });
});
