import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';
import { seriesChipEligible } from '../src/renderers/native/chrome/ChromeRenderer';

// The price scale's chip switches are config fields and renderer features — one truth each.
describe('price-scale chips', () => {
    it('round-trip as config and as features', () => {
        const r = new NativeRenderer();
        for (const key of ['rangeChips', 'indicatorChips', 'mergeChips'] as const) {
            expect(r.readFeature(key)).toBe(true);
            r.applyFeature(key, false);
            expect(r.readFeature(key)).toBe(false);
            expect(r.getConfig().priceScale[key]).toBe(false);
            expect(mergeConfig(r.getConfig(), { priceScale: { [key]: 'yes' } }).priceScale[key]).toBe(false); // garbage keeps the base
            r.applyFeature(key, true);
        }
    });

    it('the market symbol is handed to the renderer, never read from the window', () => {
        const r = new NativeRenderer();
        r.setMarketSymbol('aether:MNQ');
        expect((r as unknown as { scene: { symbol: string } }).scene.symbol).toBe('aether:MNQ');
    });
});

describe('a series can opt out of its price-scale chip', () => {
    it('a visible line with points gets a chip unless it says scaleChip: false', () => {
        expect(seriesChipEligible({ points: [1] })).toBe(true);
        expect(seriesChipEligible({ points: [1], visible: false })).toBe(false);
        expect(seriesChipEligible({ points: [] })).toBe(false);
        expect(seriesChipEligible({ points: [1], scaleChip: false })).toBe(false);
    });
});
