import { describe, it, expect } from 'vitest';
import { fmtVolume } from '../src/widget/format';

// Volume reads in the units a trader scans — thousands and millions abbreviated, small
// counts whole — so the status line's `V` never dwarfs the prices beside it.
describe('fmtVolume', () => {
    it('abbreviates thousands, millions and billions', () => {
        expect(fmtVolume(1_234)).toBe('1.23K');
        expect(fmtVolume(2_500_000)).toBe('2.50M');
        expect(fmtVolume(3_000_000_000)).toBe('3.00B');
    });

    it('keeps small counts whole', () => {
        expect(fmtVolume(287)).toBe('287');
        expect(fmtVolume(0)).toBe('0');
    });
});
