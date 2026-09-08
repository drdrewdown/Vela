import { describe, it, expect } from 'vitest';
import { readableText } from '../src/renderers/native/backend/gl/color';

// The text on a coloured price-scale chip is chosen the way the crosshair chip already chooses
// its own: black or white, whichever clears more contrast against the composited fill. The
// series chips used to keep white on any fill below a relative luminance of 0.4, and on a
// bright pink, a light blue or a pure magenta that read at 2.6–3.1:1 — small text needs 4.5:1.
const L = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
};
const contrast = (fg: number, bg: number): number => (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);

describe('price-scale chip text', () => {
    it('is black on a fill where white would fall under 4.5:1', () => {
        for (const fill of ['#ff00ff', '#ff709a', '#5aa1ff', '#ef5350', '#00ffff', '#ffb300']) {
            expect(contrast(1, L(fill)), `white on ${fill}`).toBeLessThan(4.5);
            expect(readableText(fill, '#000000'), fill).toBe('#000000');
        }
    });

    it('stays white on a fill dark enough to carry it', () => {
        for (const fill of ['#333333', '#b71c1c', '#1a237e']) {
            expect(contrast(1, L(fill)), `white on ${fill}`).toBeGreaterThanOrEqual(4.5);
            expect(readableText(fill, '#000000'), fill).toBe('#ffffff');
        }
    });

    it('composites a translucent fill over the surface before choosing', () => {
        expect(readableText('rgba(255, 0, 255, 0.35)', '#000000')).toBe('#ffffff');
        expect(readableText('rgba(255, 0, 255, 0.35)', '#ffffff')).toBe('#000000');
    });
});
