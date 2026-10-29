/**
 * Minimal IANA-timezone support for the time axis + stamps. The renderer works in
 * epoch-ms (UTC) everywhere; to render labels in a chosen zone we compute that zone's
 * UTC offset for a given instant and shift the ms before reading `getUTC*`. A single
 * offset (sampled at the visible range's midpoint) is reused across the range — exact
 * away from DST boundaries, with at most a one-hour seam across a transition, which is
 * an acceptable trade for cheap, dependency-free zoning.
 */
import { zoneOffsetMs } from '../../../core/format/dates';

const DAY_MS = 86_400_000;

/** The series' zone — the wall clock bar times are expressed in, and the zero-offset baseline
 *  of {@link tzOffsetMs}. */
const SERIES_ZONE = 'America/New_York';

/** The zone a bar time is read in. Bars of a day or longer (D, W, M and their multiples)
 *  are stamped at 00:00 of their trading date on the series' clock: a date, not an instant.
 *  Shifting one into another zone could move it onto a neighbouring day, so they read on
 *  the series' clock whatever the display zone. Intraday bars read in `timeZone`. */
export function displayZone(timeZone: string, barIntervalMs: number): string {
    return barIntervalMs >= DAY_MS ? SERIES_ZONE : timeZone;
}

/** The zone's offset from the series' clock at `ms`, in milliseconds (e.g. UTC in winter ⇒ +5h).
 *  Returns 0 for the series' zone or an empty one; an unknown zone degrades to plain UTC. */
export function tzOffsetMs(ms: number, timeZone: string): number {
    if (!timeZone || timeZone === SERIES_ZONE || timeZone === 'US/Eastern') return 0;
    return zoneOffsetMs(ms, timeZone) - zoneOffsetMs(ms, SERIES_ZONE);
}

/** The UTC instant a bar time names. Bar times are wall-clock instants on the series' clock;
 *  a formatter that takes an instant and a display zone (`chart.i18n.format`) is handed this.
 *  The offset is read again at the first guess, so a wall time just after a DST change
 *  takes the offset in force at that time, not the one before it. */
export function seriesInstant(ms: number): number {
    const guess = ms - zoneOffsetMs(ms, SERIES_ZONE);
    return ms - zoneOffsetMs(guess, SERIES_ZONE);
}

/**
 * A UTC instant (`Date.now()`) read on the series' clock. Bar times are wall-clock instants
 * in the series' zone, so any comparison of a bar with "now" — the countdown to the bar's
 * close — must read "now" the same way; against plain UTC every bar looks hours old.
 */
export function seriesNow(nowUtc: number = Date.now()): number {
    try {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: SERIES_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const parts = dtf.formatToParts(new Date(nowUtc));
        const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
        const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
        return wall + (nowUtc % 1000);
    } catch {
        return nowUtc;
    }
}

/** A `Date` whose `getUTC*` accessors read the wall-clock time in `timeZone`. */
export function zonedDate(ms: number, timeZone: string): Date {
    return new Date(ms + tzOffsetMs(ms, timeZone));
}
