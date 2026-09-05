import { describe, it, expect, afterEach } from 'vitest';
import { orderCategories, setIndicatorCategoryOrder } from '../src/widget/indicator-picker';
import { classicCategory, classicSpecs } from '../src/core/native-indicators/classics';

// Aether (UC-003): the picker's category groups follow a host-declared order; the built-in
// classics carry a family category instead of falling into one undifferentiated group.

describe('indicator picker — category order', () => {
    afterEach(() => setIndicatorCategoryOrder([]));

    it('keeps first-seen order when no order is declared', () => {
        expect(orderCategories(['Zeta', 'Alpha', 'Mid'])).toEqual(['Zeta', 'Alpha', 'Mid']);
    });

    it('declared categories come first in declared order, the rest alphabetically after', () => {
        setIndicatorCategoryOrder(['AetherTrade', 'Moving Averages', 'Oscillators']);
        expect(orderCategories(['Volume', 'Oscillators', 'Bands & Channels', 'AetherTrade', 'Moving Averages', 'Vela'])).toEqual([
            'AetherTrade',
            'Moving Averages',
            'Oscillators',
            'Bands & Channels',
            'Vela',
            'Volume',
        ]);
    });
});

describe('classic catalog — family categories', () => {
    it('every classic spec resolves to a family category', () => {
        const missing = classicSpecs.filter((s) => !classicCategory(s)).map((s) => s.type);
        expect(missing).toEqual([]);
    });

    it('a study lands in the group its family names', () => {
        const rsi = classicSpecs.find((s) => s.type === 'rsi')!;
        const bb = classicSpecs.find((s) => s.type === 'bollinger-bands' || s.title === 'Bollinger Bands')!;
        expect(classicCategory(rsi)).toBe('Oscillators');
        expect(classicCategory(bb)).toBe('Bands & Channels');
    });
});
