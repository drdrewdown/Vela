import type { Millis } from './time';

/** A single price bar. `time` is the bar's open time in epoch ms. */
export interface OHLCV {
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    /**
     * The trading day the bar belongs to, as 00:00 UTC of that date (Pine `time_tradingday`).
     * A session that opens the evening before carries the next day's date, and a session the
     * exchange books on a later date (a holiday's short session) carries that date. Absent when
     * the data does not say. Period-anchored studies (VWAP, Pivot Points) read their sessions,
     * weeks, months, quarters and years from it, and from the UTC date of `time` without it.
     */
    tradingDay?: Millis;
}
