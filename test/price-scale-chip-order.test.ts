import { describe, it, expect } from 'vitest';
import { alignScaleChips } from '../src/renderers/native/chrome/ChromeRenderer';

// Indicator chips keep the scale's order: a series priced under the market stacks BELOW the
// current-price block, one priced over it stacks above. Sides were decided against the centre
// of that block, which with the countdown pill on sits half a chip below the price — so a
// series 1.3 points under the market drew above the price chip and the scale read backwards.
const CHIP = 18;
const fixedWith = (priceY: number, countdown: boolean) => ({ top: Math.round(priceY - CHIP / 2), bottom: Math.round(priceY - CHIP / 2) + CHIP + (countdown ? CHIP + 1 : 0) });

describe('price-scale chip order', () => {
    it('a chip priced just under the market stacks below the price block, countdown on', () => {
        const priceY = 100;
        const fixed = fixedWith(priceY, true);
        const chips = [{ sY: priceY + 2, tag: 'EMA 100' }];
        alignScaleChips(chips, priceY, fixed, CHIP);
        expect(chips[0]!.sY - CHIP / 2).toBeGreaterThanOrEqual(fixed.bottom + 1);
    });

    it('a chip priced just over the market stacks above it, and neighbours keep their order', () => {
        const priceY = 100;
        const fixed = fixedWith(priceY, true);
        const chips = [{ sY: priceY - 2, tag: 'EMA 9' }, { sY: priceY - 4, tag: 'EMA 50' }, { sY: priceY + 1, tag: 'EMA 200' }];
        alignScaleChips(chips, priceY, fixed, CHIP);
        const y = (tag: string): number => chips.find((c) => c.tag === tag)!.sY;
        expect(y('EMA 9') + CHIP / 2).toBeLessThanOrEqual(fixed.top - 1);
        expect(y('EMA 50')).toBeLessThan(y('EMA 9'));
        expect(y('EMA 200') - CHIP / 2).toBeGreaterThanOrEqual(fixed.bottom + 1);
    });

    it('with no price block the chips only spread apart, in order', () => {
        const chips = [{ sY: 50 }, { sY: 52 }, { sY: 30 }];
        alignScaleChips(chips, 51, null, CHIP);
        const ys = [...chips].sort((a, b) => a.sY - b.sY).map((c) => c.sY);
        for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(CHIP + 1);
        expect(chips[2]!.sY).toBeLessThan(chips[0]!.sY);
        expect(chips[0]!.sY).toBeLessThan(chips[1]!.sY);
    });
});
