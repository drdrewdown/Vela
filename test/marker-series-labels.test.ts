import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, modelDrawingSet } from '../src/renderers/shared/DrawingSceneRenderer';
import { modelToValuePatch } from '../src/core/engine/EngineOrchestrator';
import { applyPatch } from '../src/renderers/native/NativeRenderer';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { MarkerSeries, SeriesSpec } from '../src/core/model/series';
import type { VelaTheme } from '../src/core/options';

// Aether (UC-001): a `kind: 'markers'` series is painted by mapping each marker onto a
// point-shape label — the painter that already knows above/below-bar anchoring, autoscale
// headroom, viewport clipping and hover tooltips. Before this, both backends dropped the
// series on the floor: the model declared markers, the capability flag said "supported",
// nothing painted (upstream's own Williams Fractal included).

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
