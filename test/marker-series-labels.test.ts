import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, modelDrawingSet } from '../src/renderers/shared/DrawingSceneRenderer';
import { modelToValuePatch } from '../src/core/engine/EngineOrchestrator';
import { applyPatch } from '../src/renderers/native/NativeRenderer';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { MarkerSeries, SeriesSpec } from '../src/core/model/series';
import type { VelaTheme } from '../src/core/options';

// A `kind: 'markers'` series is painted by mapping each marker onto a point-shape label —
// the painter that already knows above/below-bar anchoring, autoscale headroom, viewport
// clipping and hover tooltips. Before this, both native backends returned early for the
// series: the model declared markers, the capability flag said "supported", nothing painted
// (the built-in Williams Fractal included).

const T0 = 1_700_000_000_000;

function markers(over: Partial<MarkerSeries> = {}): MarkerSeries {
    return {
        id: 'm1',
        title: 'Signals',
        paneId: '',
        kind: 'markers',
        markers: [
            { time: T0, position: 'aboveBar', shape: 'arrowDown', color: '#ff709a', text: 'SHO', size: 'tiny' },
            { time: T0 + 60_000, position: 'belowBar', shape: 'triangleup', color: '#5aa1ff' },
            { time: T0 + 120_000, position: 'inBar', shape: 'no-such-shape', color: '#b2b5be', text: 'X', size: 'large', tooltip: 'Long story' },
        ],
        ...over,
    };
}

function model(series: SeriesSpec[]): IndicatorModel {
    return {
        id: 'ind-1',
        title: 'Patterns',
        overlay: true,
        paneHint: 'price',
        series,
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

describe('markers series → labels (modelDrawingSet)', () => {
    it('synthesises one point-shape label per marker with the renderer mapping', () => {
        const set = modelDrawingSet(model([markers()]), false);
        expect(set.labels).toHaveLength(3);

        const [a, b, c] = set.labels;
        // shape tokens are neutral and case-insensitive; unknown → circle
        expect(a!.style).toBe('arrowdown');
        expect(b!.style).toBe('triangleup');
        expect(c!.style).toBe('circle');
        // position → anchor
        expect(a!.yloc).toBe('abovebar');
        expect(b!.yloc).toBe('belowbar');
        expect(c!.yloc).toBe('inbar');
        // time-anchored, coloured, sized; text doubles as the hover tooltip
        expect(a!.xloc).toBe('bar_time');
        expect(a!.x).toBe(T0);
        expect(a!.color).toBe('#ff709a');
        expect(a!.size).toBe('tiny');
        expect(a!.text).toBe('SHO');
        expect(a!.tooltip).toBe('SHO');
        expect(b!.size).toBe('small'); // default marker size
        expect(c!.tooltip).toBe('Long story'); // explicit tooltip wins over text
        expect(b!.text).toBeUndefined();
        // stable, series-scoped ids (label merge / tooltips key on them)
        expect(new Set(set.labels.map((l) => l.id)).size).toBe(3);
        expect(a!.id.startsWith('m1:')).toBe(true);
    });

    it('memoises on the markers array: same array → same labels, a patched array → fresh ones', () => {
        const m = model([markers()]);
        const a = modelDrawingSet(m, false).labels;
        const b = modelDrawingSet(m, false).labels;
        expect(b[0]).toBe(a[0]); // no per-frame allocation for unchanged markers
        (m.series[0] as MarkerSeries).markers = [...(m.series[0] as MarkerSeries).markers];
        const c = modelDrawingSet(m, false).labels;
        expect(c[0]).not.toBe(a[0]);
        expect(c[0]).toEqual(a[0]);
    });

    it('a time window slices the marker labels by binary search; Pine labels are untouched', () => {
        const m = model([markers()]);
        m.labels = [{ id: 'pine', paneId: '', xloc: 'bar_time', x: T0 - 999_999, y: 1, yloc: 'price', style: 'label_up', size: 'normal', textAlign: 'center', fontFamily: 'default' }];
        const mid = modelDrawingSet(m, false, { from: T0 + 30_000, to: T0 + 90_000 }).labels;
        expect(mid.map((l) => l.id)).toEqual(['pine', `m1:${T0 + 60_000}:1`]);
        expect(modelDrawingSet(m, false, { from: T0 + 500_000, to: T0 + 900_000 }).labels.map((l) => l.id)).toEqual(['pine']);
        expect(modelDrawingSet(m, false).labels).toHaveLength(4);
    });

    it('an unsorted markers series is sorted once so the window search stays valid', () => {
        const m = model([markers({ markers: [...markers().markers].reverse() })]);
        const all = modelDrawingSet(m, false).labels.map((l) => l.x);
        expect(all).toEqual([T0, T0 + 60_000, T0 + 120_000]);
        expect(modelDrawingSet(m, false, { from: T0 + 100_000, to: T0 + 200_000 }).labels.map((l) => l.x)).toEqual([T0 + 120_000]);
    });

    it('follows the series overlay flag like plots do, and leaves Pine labels untouched', () => {
        const forced = markers({ id: 'm2', overlay: true });
        const m = model([markers(), forced]);
        m.labels = [{ id: 'pine', paneId: '', xloc: 'bar_time', x: T0, y: 1, yloc: 'price', style: 'label_up', size: 'normal', textAlign: 'center', fontFamily: 'default' }];
        const own = modelDrawingSet(m, false);
        const onPrice = modelDrawingSet(m, true);
        expect(own.labels.map((l) => l.id)).toEqual(['pine', ...own.labels.slice(1).map((l) => l.id)]);
        expect(own.labels.filter((l) => l.id.startsWith('m1:'))).toHaveLength(3);
        expect(own.labels.filter((l) => l.id.startsWith('m2:'))).toHaveLength(0);
        expect(onPrice.labels.filter((l) => l.id.startsWith('m2:'))).toHaveLength(3);
        expect(onPrice.labels.filter((l) => l.id.startsWith('m1:'))).toHaveLength(0);
    });
});

describe('markers series survive live value patches', () => {
    it('modelToValuePatch carries a markers delta and widens the dirty range to the markers', () => {
        const p = modelToValuePatch(model([markers()]));
        const delta = p.series.find((d) => d.seriesId === 'm1');
        expect(delta?.kind).toBe('markers');
        expect(delta && delta.kind === 'markers' ? delta.markers.length : 0).toBe(3);
        expect(p.dirty.from).toBe(T0);
        expect(p.dirty.to).toBe(T0 + 120_000);
    });

    it('applyPatch replaces the stored markers', () => {
        const stored = model([markers({ markers: [] })]);
        applyPatch(stored, modelToValuePatch(model([markers()])));
        const s = stored.series[0] as MarkerSeries;
        expect(s.markers).toHaveLength(3);
        expect(s.markers[2]!.position).toBe('inBar');
    });
});

describe('markers paint through the label painter', () => {
    const theme = { fontFamily: 'sans-serif', textColor: '#ddd' } as VelaTheme;
    const bar = { time: T0, open: 10, high: 12, low: 8, close: 11, volume: 1 };

    function paint(series: SeriesSpec[]) {
        const texts: Array<{ text: string; x: number; y: number }> = [];
        const ctx = new Proxy({} as Record<string, unknown>, {
            get: (_t, k: string) =>
                k === 'fillText'
                    ? (text: string, x: number, y: number) => texts.push({ text, x, y })
                    : k === 'measureText'
                      ? () => ({ width: 10 })
                      : () => undefined,
            set: () => true,
        }) as unknown as CanvasRenderingContext2D;
        const scene = new DrawingSceneRenderer(
            { timeToLogical: (ms) => (ms - T0) / 60_000, barAt: () => bar, theme },
            modelDrawingSet(model(series), false),
        );
        scene.render(ctx, 800, 400, (l) => l * 10, (p) => 400 - p * 10);
        return { scene, texts };
    }

    it('an above-bar marker sits 14px over the bar high and its text is the hover tip', () => {
        const { texts, scene } = paint([markers()]);
        const sho = texts.find((t) => t.text === 'SHO');
        expect(sho).toBeDefined();
        const highY = 400 - 12 * 10;
        expect(sho!.y).toBeGreaterThan(highY - 14); // text hangs below the glyph anchor
        expect(sho!.y).toBeLessThan(highY + 20);
        const tips = scene.labelTipRegions().map((r) => r.text);
        expect(tips).toContain('SHO');
    });

    it('an in-bar marker anchors at the bar midpoint', () => {
        const { texts } = paint([markers()]);
        const x = texts.find((t) => t.text === 'X');
        expect(x).toBeDefined();
        const midY = 400 - ((12 + 8) / 2) * 10;
        expect(Math.abs(x!.y - midY)).toBeLessThan(30);
    });
});
