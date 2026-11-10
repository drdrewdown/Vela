import { DARK_CHART, LIGHT_CHART, type UiTheme } from '@luxalgo/vela-ui/theme';
import type { ChromeTokens, VelaTheme, ThemeId } from './options';

// The reference dark palette (the design spec's first-run chart cosmetics: surface,
// axis text, subtle grid, candle green/red).
export const DARK_THEME: VelaTheme = DARK_CHART;

export const LIGHT_THEME: VelaTheme = LIGHT_CHART;

/** A theme offered by id, next to Dark and Light, in the chart settings' theme choice. */
export interface RegisteredTheme {
    id: string;
    label: string;
    theme: VelaTheme | UiTheme;
}

const registry = new Map<string, RegisteredTheme>();

/** Offer a theme by id: `theme: '<id>'`, `setTheme('<id>')` and the chart settings' theme
 *  choice. Registering an id again replaces it. Returns the unregister function. */
export function registerTheme(entry: RegisteredTheme): () => void {
    if (entry.id === 'dark' || entry.id === 'light') throw new Error(`registerTheme: "${entry.id}" is a built-in theme`);
    registry.set(entry.id, entry);
    return () => {
        if (registry.get(entry.id) === entry) registry.delete(entry.id);
    };
}

/** The registered themes, in registration order. */
export function registeredThemes(): readonly RegisteredTheme[] {
    return [...registry.values()];
}

const resolved = new WeakMap<UiTheme, VelaTheme>();

/** The chart theme for a theme option. A `createTheme` result resolves to its chart colors
 *  with its settings (one object per theme, so re-resolving it is not a theme change); an
 *  unknown id resolves to the dark theme. */
export function resolveTheme(theme?: ThemeId | VelaTheme | UiTheme): VelaTheme {
    if (!theme || theme === 'dark') return DARK_THEME;
    if (theme === 'light') return LIGHT_THEME;
    if (typeof theme === 'string') {
        const entry = registry.get(theme);
        return entry ? resolveTheme(entry.theme) : DARK_THEME;
    }
    if ('tokens' in theme) {
        let t = resolved.get(theme);
        if (!t) resolved.set(theme, (t = { ...theme.chart, ui: theme.settings }));
        return t;
    }
    return theme;
}

const themeKey = (t: VelaTheme) => JSON.stringify([t.background, t.textColor, t.gridColor, t.borderColor, t.upColor, t.downColor, t.fontFamily, t.ui ?? null, t.chrome ?? null]);

/** The id of the registered theme a chart theme is, if any. */
export function registeredThemeIdOf(theme: VelaTheme): string | null {
    const key = themeKey(theme);
    for (const entry of registry.values()) if (themeKey(resolveTheme(entry.theme)) === key) return entry.id;
    return null;
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
