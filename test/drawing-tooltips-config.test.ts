// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';
import { LabelTooltip } from '../src/renderers/native/chrome/LabelTooltip';
import type { VelaTheme } from '../src/core/options';

// Hover tooltips on indicator drawings (Pine labels, boxes and table cells that carry a
// `tooltip`) are chart config: a host that renders its own hover card from
// `readoutAt().labelTooltip` turns the renderer's tip off instead of fighting it.

describe('drawing tooltips', () => {
    it('is a config field: on by default, booleans only', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.tooltips).toEqual({ drawings: true });
        expect(mergeConfig(base, { tooltips: { drawings: false } }).tooltips.drawings).toBe(false);
        expect(mergeConfig(base, { tooltips: { drawings: 'no' } }).tooltips.drawings).toBe(true);
        expect(mergeConfig(base, {}).tooltips.drawings).toBe(true);
    });

    it('is the drawingTooltips feature, and the two agree', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('drawingTooltips');
        expect(r.readFeature('drawingTooltips')).toBe(true);
        r.applyFeature('drawingTooltips', false);
        expect(r.readFeature('drawingTooltips')).toBe(false);
        expect(r.getConfig().tooltips.drawings).toBe(false);
        r.applyConfig({ tooltips: { drawings: true } });
        expect(r.readFeature('drawingTooltips')).toBe(true);
    });
});

/** A mouse `pointermove` over the plot (jsdom has no PointerEvent). */
function hover(plot: HTMLElement, x: number, y: number): void {
    const e = new MouseEvent('pointermove', { clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    plot.dispatchEvent(e);
}

describe('LabelTooltip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('opens a tip with the label text after a short hover', () => {
        const plot = document.createElement('div');
        document.body.append(plot);
        const tip = new LabelTooltip(plot, {
            theme: () => ({ background: '#000', textColor: '#fff', borderColor: '#333', fontFamily: 'sans-serif' } as VelaTheme),
            lookup: (x, y) => (x < 100 && y < 100 ? 'Order block · 5400.25' : null),
        });
        hover(plot, 40, 40);
        expect(plot.children).toHaveLength(0); // not yet — a sweep through a label must not flash
        vi.advanceTimersByTime(400);
        expect(plot.children).toHaveLength(1);
        expect(plot.children[0]!.textContent).toBe('Order block · 5400.25');
        hover(plot, 400, 40);
        expect(plot.children).toHaveLength(0);
        tip.destroy();
    });
});
