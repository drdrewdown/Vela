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

/** The plot subset the tip touches — tests run in a plain node environment. */
interface StubPlot {
    handlers: Record<string, (e: unknown) => void>;
    children: Array<{ textContent: string }>;
    plot: HTMLElement;
}

function stubPlot(): StubPlot {
    const handlers: Record<string, (e: unknown) => void> = {};
    const children: Array<{ textContent: string }> = [];
    const makeEl = () => ({
        textContent: '',
        offsetWidth: 80,
        offsetHeight: 20,
        style: { cssText: '', setProperty: () => undefined },
        remove: () => {
            const i = children.findIndex((c) => c === el);
            if (i >= 0) children.splice(i, 1);
        },
    });
    let el: ReturnType<typeof makeEl>;
    const plot = {
        clientWidth: 800,
        clientHeight: 400,
        ownerDocument: { createElement: () => (el = makeEl()) },
        addEventListener: (name: string, fn: (e: unknown) => void) => { handlers[name] = fn; },
        removeEventListener: () => undefined,
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        appendChild: (c: { textContent: string }) => { children.push(c); },
    } as unknown as HTMLElement;
    return { handlers, children, plot };
}

describe('LabelTooltip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', globalThis); // the tip arms its hover delay on `window.setTimeout`
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('opens a tip with the label text after a short hover', () => {
        const { handlers, children, plot } = stubPlot();
        const tip = new LabelTooltip(plot, {
            theme: () => ({ background: '#000', textColor: '#fff', borderColor: '#333', fontFamily: 'sans-serif' } as VelaTheme),
            lookup: (x, y) => (x < 100 && y < 100 ? 'Order block · 5400.25' : null),
        });
        handlers.pointermove!({ pointerType: 'mouse', clientX: 40, clientY: 40 });
        expect(children).toHaveLength(0); // not yet — a sweep through a label must not flash
        vi.advanceTimersByTime(400);
        expect(children).toHaveLength(1);
        expect(children[0]!.textContent).toBe('Order block · 5400.25');
        handlers.pointermove!({ pointerType: 'mouse', clientX: 400, clientY: 40 });
        expect(children).toHaveLength(0);
        tip.destroy();
    });
});
