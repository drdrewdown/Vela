import { describe, it, expect } from 'vitest';
import { priceStyleIds, priceStyleLabel, BUILTIN_PRICE_STYLES } from '../src/renderers/native/core/chartConfig';
import '../src/chart-types/builtins';

// One list, one label map: every menu that offers a price style reads these, so a style can
// never appear under a raw id in one place and a name in another.
describe('price styles — one list, one label map', () => {
    it('every offered style has a display name (no raw ids leak into menus)', () => {
        for (const id of priceStyleIds()) expect(priceStyleLabel(id), id).not.toBe(id);
    });
    it('hollow candles are a first-class built-in style with a proper name', () => {
        expect(BUILTIN_PRICE_STYLES).toContain('hollow');
        expect(priceStyleLabel('hollow')).toBe('Hollow Candles');
    });
    it('registry labels win for chart types (Heikin Ashi)', () => {
        expect(priceStyleLabel('heikinashi')).toBe('Heikin Ashi');
    });
});
