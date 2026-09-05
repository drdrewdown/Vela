import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';

// Whether the indicator legend is folded behind its chevron is chart config: hosts that
// remember the trader's choice set `legend.folded`, the chevron reports back through the
// same field, and a remount or a row-count dip cannot lose it.
describe('legend fold', () => {
    it('is a config field: unfolded by default, booleans only', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.legend).toEqual({ folded: false });
        expect(mergeConfig(base, { legend: { folded: true } }).legend.folded).toBe(true);
        expect(mergeConfig(base, { legend: { folded: 'yes' } }).legend.folded).toBe(false);
        expect(mergeConfig(base, {}).legend.folded).toBe(false);
    });

    it('is a renderer feature that round-trips through the config and reaches config listeners', () => {
        const r = new NativeRenderer();
        let notified = 0;
        r.onConfigChanged(() => notified++);
        expect(r.features).toContain('legendFolded');
        expect(r.readFeature('legendFolded')).toBe(false);
        r.applyFeature('legendFolded', true);
        expect(r.readFeature('legendFolded')).toBe(true);
        expect(r.getConfig().legend.folded).toBe(true);
        expect(notified).toBeGreaterThan(0);
    });
});
