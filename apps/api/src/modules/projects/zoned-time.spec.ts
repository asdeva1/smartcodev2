import { addDays, dayKey, monthStart, zonedDayStart } from './zoned-time';

describe('zoned time', () => {
  it('finds the start of an Indian calendar day (UTC+5:30)', () => {
    expect(zonedDayStart('2026-10-09', 'Asia/Kolkata').toISOString()).toBe('2026-10-08T18:30:00.000Z');
  });

  it('keeps a late-evening IST instant on the Indian day, not the UTC day', () => {
    expect(dayKey(new Date('2026-10-09T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-10');
    expect(dayKey(new Date('2026-10-09T20:00:00Z'), 'UTC')).toBe('2026-10-09');
  });

  it('handles a daylight-saving change day', () => {
    // New York, 2026-11-01: clocks go back, the day is 25 hours long.
    const start = zonedDayStart('2026-11-01', 'America/New_York');
    const next = zonedDayStart('2026-11-02', 'America/New_York');
    expect((next.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it('adds days across month ends and finds the month start', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(monthStart('2026-10-17')).toBe('2026-10-01');
  });
});
