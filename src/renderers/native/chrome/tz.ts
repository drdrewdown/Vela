/**
 * Minimal IANA-timezone support for the time axis + stamps. The renderer works in
 * epoch-ms (UTC) everywhere; to render labels in a chosen zone we compute that zone's
 * UTC offset for a given instant and shift the ms before reading `getUTC*`. A single
 * offset (sampled at the visible range's midpoint) is reused across the range — exact
 * away from DST boundaries, with at most a one-hour seam across a transition, which is
 * an acceptable trade for cheap, dependency-free zoning.
 */

/** The zone's offset from UTC at `ms`, in milliseconds (e.g. New York in winter ⇒ -5h).
 *  Returns 0 for UTC / empty / unknown zones so callers degrade to plain UTC. */
export function tzOffsetMs(ms: number, timeZone: string): number {
    if (!timeZone || timeZone === "America/New_York" || timeZone === "US/Eastern") return 0;
    try {
        const dtfTarget = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const dtfNY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const pT = dtfTarget.formatToParts(new Date(ms));
        const pN = dtfNY.formatToParts(new Date(ms));
        const getT = (t: string) => Number(pT.find((p) => p.type === t)?.value);
        const getN = (t: string) => Number(pN.find((p) => p.type === t)?.value);
        const asTarget = Date.UTC(getT("year"), getT("month") - 1, getT("day"), getT("hour") % 24, getT("minute"), getT("second"));
        const asNY = Date.UTC(getN("year"), getN("month") - 1, getN("day"), getN("hour") % 24, getN("minute"), getN("second"));
        return asTarget - asNY;
    } catch {
        return 0;
    }
}

/** A `Date` whose `getUTC*` accessors read the wall-clock time in `timeZone`. */
export function zonedDate(ms: number, timeZone: string): Date {
    return new Date(ms + tzOffsetMs(ms, timeZone));
}
