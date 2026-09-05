import { describe, it, expect } from 'vitest';
import { pointerReadout, chipAt, CHIP_HIT_PAD, type ReadoutSource } from '../src/renderers/native/core/readout';
import type { ScaleChip } from '../src/core/ports/IChartRenderer';

// What is under a screen point — the seam a host's hover card builds on instead of reading
// the scene, the coordinate system and the chrome's chip boxes directly.
const scale = (min: number, max: number) => ({ min, max, log: false, invert: false }) as never;
const chip = (tag: string, x: number): ScaleChip => ({
    tag, title: tag, priceText: '1', tooltip: `${tag} tip`, color: '#fff',
    boxPrice: { x, y: 10, w: 40, h: 14 }, boxTag: { x: x + 44, y: 10, w: 20, h: 14 }, meta: { type: tag },
});
const src: ReadoutSource = {
    panes: [
        { id: 'price', kind: 'price', bounds: { top: 0, height: 200 } as never, scale: scale(100, 200) },
        { id: 'p2', kind: 'study', bounds: { top: 200, height: 100 } as never, scale: scale(-50, 50) },
    ],
    indicators: [{ id: 'native-1', paneId: 'price' }, { id: 'native-2', paneId: 'p2' }, { id: 'native-3', paneId: 'p2' }],
    bars: [0, 1, 2, 3].map((i) => ({ time: 1000 + i, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 10 })),
    chips: [chip('EMA9', 300)],
    coords: {
        xToLogical: (x) => x / 10,
        yToPrice: (y, s, b) => (s as { max: number; min: number }).max - ((y - b.top) / b.height) * ((s as { max: number }).max - (s as { min: number }).min),
    },
    labelTooltipAt: (x, y) => (x === 5 && y === 5 ? 'label tip' : null),
};

describe('pointerReadout', () => {
    it('resolves the pane, its value at y, the indicators on it, and the bar under x', () => {
        const r = pointerReadout(src, 20, 50);
        expect(r.pane).toEqual({ id: 'price', kind: 'price', value: 175, indicatorIds: ['native-1'] });
        expect(r.bar).toEqual({ index: 2, time: 1002, open: 2, high: 3, low: 1, close: 2.5, volume: 10 });
        expect(r.chip).toBeNull();
        expect(r.labelTooltip).toBeNull();
        const s = pointerReadout(src, 21, 250);
        expect(s.pane).toEqual({ id: 'p2', kind: 'study', value: 0, indicatorIds: ['native-2', 'native-3'] });
    });

    it('is honest off the plot: no pane below the last one, no bar beyond the history', () => {
        expect(pointerReadout(src, 20, 350).pane).toBeNull();
        expect(pointerReadout(src, 90, 50).bar).toBeNull();
        expect(pointerReadout(src, -30, 50).bar).toBeNull();
    });

    it('hit-tests price-scale chips on either box with a small pad', () => {
        expect(chipAt(src.chips, 320, 15)?.tag).toBe('EMA9'); // price box
        expect(chipAt(src.chips, 350, 15)?.tag).toBe('EMA9'); // tag box
        expect(chipAt(src.chips, 300 - CHIP_HIT_PAD, 15)?.tag).toBe('EMA9');
        expect(chipAt(src.chips, 300 - CHIP_HIT_PAD - 1, 15)).toBeNull();
        expect(pointerReadout(src, 320, 15).chip?.meta).toEqual({ type: 'EMA9' });
    });

    it('carries a drawing label tooltip under the point', () => {
        expect(pointerReadout(src, 5, 5).labelTooltip).toBe('label tip');
    });
});
