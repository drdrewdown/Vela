import { describe, it, expect } from 'vitest';
import { tagText } from '../src/renderers/native/backend/gl/color';

// The text on a coloured price-scale chip stays white while white still clears 3:1 against the
// fill (WCAG AA for large text), and turns black once it does not. A bright pink or a light blue
// fill sits just under the old flip point, and white text on either fell to about 2.6:1.
function contrast(fg: number, bg: number): number {
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}
const L = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
};

describe('price-scale chip text', () => {
    it('turns black on a fill where white text falls under 3:1', () => {
        for (const fill of ['#ff709a', '#5aa1ff', '#00bcd4', '#ffb300']) {
            expect(contrast(1, L(fill)), `white on ${fill}`).toBeLessThan(3.1);
            expect(tagText(fill, '#000000'), fill).toBe('#000000');
        }
    });

    it('keeps white on a saturated fill that still carries it', () => {
        for (const fill of ['#8064d3', '#ef5350', '#1e88e5', '#333333']) {
            expect(contrast(1, L(fill)), `white on ${fill}`).toBeGreaterThanOrEqual(3);
            expect(tagText(fill, '#000000'), fill).toBe('#ffffff');
        }
    });

    it('composites a translucent fill over the surface before choosing', () => {
        expect(tagText('rgba(255, 112, 154, 0.35)', '#000000')).toBe('#ffffff');
        expect(tagText('rgba(255, 112, 154, 0.35)', '#ffffff')).toBe('#000000');
    });
});
