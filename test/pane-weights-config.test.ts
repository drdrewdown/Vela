import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';

// Pane heights are chart config (`panes.weights`, by pane id): they travel with the rest of
// the cosmetic document a host persists, instead of the renderer writing to browser storage.
describe('pane weights', () => {
    it('are a config field: empty by default, positive finite numbers by pane id, junk dropped', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.panes.weights).toEqual({});
        const out = mergeConfig(base, { panes: { weights: { price: 3, 'pane-2': 1.5, bad: -1, worse: 'x', nan: NaN } } });
        expect(out.panes.weights).toEqual({ price: 3, 'pane-2': 1.5 });
        expect(mergeConfig(base, { panes: { weights: 'nope' } }).panes.weights).toEqual({});
    });

    it('round-trip through the renderer and reach config listeners', () => {
        const r = new NativeRenderer();
        let notified = 0;
        r.onConfigChanged(() => notified++);
        r.applyConfig({ panes: { weights: { price: 2, 'pane-2': 1 } } });
        expect(r.getConfig().panes.weights).toEqual({ price: 2, 'pane-2': 1 });
        expect(notified).toBeGreaterThan(0);
    });
});
