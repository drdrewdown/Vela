import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

// `priceScale.side` is the one place the scale's edge is decided; its pixel consequence is
// `coords.leftOffsetPx`, which every painter reads instead of a global.
describe('price scale side', () => {
    it('is a config field: right by default, left when asked, garbage ignored', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.priceScale.side).toBe('right');
        expect(mergeConfig(base, { priceScale: { side: 'left' } }).priceScale.side).toBe('left');
        expect(mergeConfig(base, { priceScale: { side: 'sideways' } }).priceScale.side).toBe('right');
    });

    it('is a renderer feature that round-trips through the config', () => {
        const r = new NativeRenderer();
        expect(r.get('scaleSide')).toBe('right');
        r.set('scaleSide', 'left');
        expect(r.get('scaleSide')).toBe('left');
        expect(r.getConfig().priceScale.side).toBe('left');
    });

    it('a left gutter shifts the x mapping by exactly the gutter, and back', () => {
        const c = new CoordinateSystem();
        c.setBars([0, 60_000, 120_000]);
        c.setSize(300, 100, 1, 0);
        const xRight = c.logicalToX(2);
        c.setSize(300, 100, 1, 60);
        expect(c.logicalToX(2)).toBe(xRight + 60);
        expect(c.xToLogical(c.logicalToX(1))).toBeCloseTo(1, 9);
    });
});
