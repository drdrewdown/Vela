// The renderer's time axis works in the series' own wall clock (see tz.ts: New York is the
// zero-offset baseline), so anything that compares a bar's time with "now" has to read
// "now" on that same clock. The countdown-to-bar-close chip compared bar opens in series
// time against `Date.now()` in UTC: every bar looked hours old and the chip never showed.
import { describe, it, expect } from 'vitest';
import { seriesNow, tzOffsetMs } from '../src/renderers/native/chrome/tz';
import { countdownText } from '../src/renderers/native/chrome/countdown';

const H = 3_600_000;
const MIN = 60_000;

describe('seriesNow — a UTC instant on the series clock', () => {
    it('is four hours behind UTC in New York summer time and five in winter', () => {
        const summer = Date.UTC(2026, 8, 16, 4, 41, 0); // 2026-09-16 04:41Z = 00:41 New York (EDT)
        expect(seriesNow(summer)).toBe(summer - 4 * H);
        const winter = Date.UTC(2026, 0, 15, 4, 41, 0); // 2026-01-15 04:41Z = 23:41 New York (EST)
        expect(seriesNow(winter)).toBe(winter - 5 * H);
    });

    it('keeps the baseline: the series zone reads as offset zero on the axis', () => {
        expect(tzOffsetMs(Date.UTC(2026, 8, 16), 'America/New_York')).toBe(0);
    });

    it('lets the countdown see a live bar for what it is', () => {
        const nowUtc = Date.UTC(2026, 8, 16, 4, 41, 20); // 00:41:20 New York
        const barOpenSeries = Date.UTC(2026, 8, 16, 0, 41, 0); // the 00:41 bar, in series time
        expect(countdownText(barOpenSeries, MIN, nowUtc)).toBeNull(); // read in UTC: "closed hours ago"
        expect(countdownText(barOpenSeries, MIN, seriesNow(nowUtc))).toBe('00:40');
    });
});
