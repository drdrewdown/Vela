import { describe, it, expect } from 'vitest';
import { DARK_THEME, LIGHT_THEME, resolveChrome, mixHex, withAlpha } from '../src/core/theme';

// The scale's chrome accents (current-price chip, countdown pill, range chips) come from the
// theme: a host may set them, and a theme that does not gets a legible default derived from
// its own surface, text and candle colours — never a colour typed into the painter.
describe('chrome tokens', () => {
    it('derive from the base tokens when a theme does not set them', () => {
        const c = resolveChrome(DARK_THEME);
        for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
        expect(c.chipBackground).not.toBe(DARK_THEME.background);
        const l = resolveChrome(LIGHT_THEME);
        expect(l.chipBackground).not.toBe(c.chipBackground);
    });

    it('an explicit token wins over the derived one', () => {
        const c = resolveChrome({ ...DARK_THEME, chrome: { countdownText: '#123456' } });
        expect(c.countdownText).toBe('#123456');
        expect(c.chipText).toBe(resolveChrome(DARK_THEME).chipText);
    });

    it('colour maths', () => {
        expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
        expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
        expect(withAlpha('#ff709a', 0.35)).toBe('rgba(255, 112, 154, 0.35)');
    });
});
