import type { ChromeTokens, VelaTheme, ThemeName } from './options';
import { BEARISH, BULLISH } from './palette';

// The reference dark palette (the design spec's first-run chart cosmetics: surface,
// axis text, subtle grid, candle green/red).
export const DARK_THEME: VelaTheme = {
    background: "#07090d",
    textColor: "#c8d0de",
    gridColor: "#0e131d",
    borderColor: "#161d2b",
    upColor: "#5aa1ff",
    downColor: "#ff709a",
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif"
};

export const LIGHT_THEME: VelaTheme = {
    background: '#ffffff',
    textColor: '#1e293b',
    // Soft chrome on white: grid is a neutral wash; pane separator / axis border
    // (they inherit `borderColor`) sit a step darker so stacked panes stay distinct.
    gridColor: '#cccccc',
    borderColor: '#d4dae3',
    // Candle hues are shared across themes: switching themes recolors surfaces and
    // text, never the series (a green candle stays the same green on white).
    upColor: BULLISH,
    downColor: BEARISH,
    fontFamily: 'sans-serif',
};

export function resolveTheme(theme?: ThemeName | VelaTheme): VelaTheme {
    if (!theme || theme === 'dark') return DARK_THEME;
    if (theme === 'light') return LIGHT_THEME;
    return theme;
}

const hexToRgb = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** `a` moved `t` of the way to `b` (both `#rrggbb`), as `#rrggbb`. */
export function mixHex(a: string, b: string, t: number): string {
    const [ar, ag, ab] = hexToRgb(a);
    const [br, bg, bb] = hexToRgb(b);
    return `#${toHex(ar + (br - ar) * t)}${toHex(ag + (bg - ag) * t)}${toHex(ab + (bb - ab) * t)}`;
}

/** A `#rrggbb` colour as `rgba(r, g, b, a)`. */
export function withAlpha(hex: string, alpha: number): string {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The chrome accents a theme paints with: its own where set, otherwise derived so the
 *  chips stay legible on that theme's surface and read in its candle colours. */
export function resolveChrome(theme: VelaTheme): ChromeTokens {
    const c = theme.chrome ?? {};
    return {
        chipBackground: c.chipBackground ?? mixHex(theme.background, theme.textColor, 0.28),
        chipText: c.chipText ?? mixHex(theme.textColor, '#ffffff', 0.6),
        countdownBackground: c.countdownBackground ?? mixHex(theme.background, theme.downColor, 0.18),
        countdownText: c.countdownText ?? mixHex(theme.downColor, '#ffffff', 0.15),
        rangeHighBackground: c.rangeHighBackground ?? mixHex(theme.background, theme.upColor, 0.08),
        rangeHighText: c.rangeHighText ?? mixHex(theme.textColor, theme.upColor, 0.35),
        rangeLowBackground: c.rangeLowBackground ?? mixHex(theme.background, theme.downColor, 0.08),
        rangeLowText: c.rangeLowText ?? mixHex(theme.textColor, theme.downColor, 0.35),
    };
}
