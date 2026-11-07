import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET } from '../src/renderers/shared/DrawingSceneRenderer';
import type { DrawingBox, DrawingPolyline } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

// A box's `bgGradient` and a closed polyline's `fillGradient` paint a vertical gradient: offset 0
// at the shape's top edge, 1 at its bottom, in place of the flat fill.

const theme = { fontFamily: 'sans-serif', textColor: '#ddd' } as VelaTheme;

interface Gradient {
    args: number[];
    stops: Array<[number, string]>;
}

function recorder() {
    const gradients: Gradient[] = [];
    const fills: unknown[] = [];
    const texts: Array<[string, unknown]> = [];
    let fillStyle: unknown = null;
    const ctx = new Proxy({} as Record<string, unknown>, {
        get: (_t, k: string) => {
            if (k === 'fillStyle') return fillStyle;
            if (k === 'measureText') return () => ({ width: 40 });
            if (k === 'createLinearGradient') {
                return (...args: number[]) => {
                    const g: Gradient = { args, stops: [] };
                    gradients.push(g);
                    return { addColorStop: (offset: number, color: string) => g.stops.push([offset, color]), gradient: g };
                };
            }
            if (k === 'fillRect' || k === 'fill') return () => fills.push(fillStyle);
            if (k === 'fillText') return (text: string) => texts.push([text, fillStyle]);
            return () => undefined;
        },
        set: (_t, k: string, v) => {
            if (k === 'fillStyle') fillStyle = v;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, gradients, fills, texts };
}

function box(over: Partial<DrawingBox>): DrawingBox {
    return {
        id: 'b1',
        paneId: 'price',
        xloc: 'bar_index',
        left: 0,
        right: 100,
        top: 80,
        bottom: 20,
        extend: 'none',
        borderWidth: 0,
        borderStyle: 'solid',
        textSize: 'small',
        hAlign: 'center',
        vAlign: 'center',
        wrap: false,
        fontFamily: 'default',
        bold: false,
        italic: false,
        ...over,
    };
}

function polyline(over: Partial<DrawingPolyline>): DrawingPolyline {
    return {
        id: 'p1',
        paneId: 'price',
        points: [
            { xloc: 'bar_index', x: 50, price: 90 },
            { xloc: 'bar_index', x: 70, price: 50 },
            { xloc: 'bar_index', x: 50, price: 10 },
            { xloc: 'bar_index', x: 30, price: 50 },
        ],
        curved: false,
        closed: true,
        lineWidth: 1,
        lineStyle: 'solid',
        arrowLeft: false,
        arrowRight: false,
        ...over,
    };
}

function paint(set: Partial<typeof EMPTY_DRAWING_SET>, yOf: (p: number) => number = (p) => 100 - p) {
    const r = recorder();
    const scene = new DrawingSceneRenderer({ timeToLogical: (ms) => ms, barAt: () => null, theme }, { ...EMPTY_DRAWING_SET, ...set });
    // identity x; by default y flips so price 100 is at pixel 0 and price 0 at pixel 100
    scene.render(r.ctx, 800, 400, (l) => l, yOf);
    return r;
}

const STOPS = [
    { offset: 0, color: 'rgba(90,161,255,0.9)' },
    { offset: 0.5, color: 'rgba(92,102,117,0.3)' },
    { offset: 1, color: 'rgba(255,112,154,0.6)' },
];

describe('vertical gradient fills', () => {
    it('a box with bgGradient fills its rectangle with a gradient from its top edge to its bottom', () => {
        const { gradients, fills } = paint({ boxes: [box({ bgColor: '#123', bgGradient: STOPS })] });
        expect(gradients).toHaveLength(1);
        // the box spans prices 80..20: pixels 20..80
        expect(gradients[0]!.args).toEqual([0, 20, 0, 80]);
        expect(gradients[0]!.stops).toEqual(STOPS.map((s) => [s.offset, s.color]));
        expect(fills).toHaveLength(1);
        expect((fills[0] as { gradient: Gradient }).gradient).toBe(gradients[0]);
    });

    it('a box without one keeps its flat fill', () => {
        const { gradients, fills } = paint({ boxes: [box({ bgColor: '#123' })] });
        expect(gradients).toHaveLength(0);
        expect(fills).toEqual(['#123']);
    });

    it('a closed polyline with fillGradient fills its path from its highest point to its lowest', () => {
        const { gradients, fills } = paint({ polylines: [polyline({ fillColor: '#123', fillGradient: STOPS })] });
        expect(gradients).toHaveLength(1);
        expect(gradients[0]!.args).toEqual([0, 10, 0, 90]);
        expect(gradients[0]!.stops).toEqual(STOPS.map((s) => [s.offset, s.color]));
        expect((fills[0] as { gradient: Gradient }).gradient).toBe(gradients[0]);
    });

    it('clamps a stop outside 0..1 to the nearest edge', () => {
        const { gradients } = paint({ boxes: [box({ bgGradient: [{ offset: -0.2, color: '#111' }, { offset: 1.4, color: '#222' }] })] });
        expect(gradients[0]!.stops).toEqual([[0, '#111'], [1, '#222']]);
    });

    it('a box with only a gradient still counts for the autoscale', () => {
        const scene = new DrawingSceneRenderer({ timeToLogical: (ms) => ms, barAt: () => null, theme }, { ...EMPTY_DRAWING_SET, boxes: [box({ bgGradient: STOPS })] });
        const range = scene.priceRange(0, 200);
        expect(range).not.toBeNull();
        expect([range!.min, range!.max]).toEqual([20, 80]);
    });

    it('keeps offset 0 at the top price on an inverted scale', () => {
        // inverted: price 0 at pixel 0, price 100 at pixel 100
        const inv = (p: number) => p;
        const b = paint({ boxes: [box({ bgGradient: STOPS })] }, inv);
        expect(b.gradients[0]!.args).toEqual([0, 80, 0, 20]);
        const p = paint({ polylines: [polyline({ fillGradient: STOPS })] }, inv);
        expect(p.gradients[0]!.args).toEqual([0, 90, 0, 10]);
    });

    it('picks the default text colour against the gradient it paints, not an unpainted bgColor', () => {
        const dark = [{ offset: 0, color: '#101820' }, { offset: 0.5, color: '#141c24' }, { offset: 1, color: '#202830' }];
        const { texts } = paint({ boxes: [box({ bgColor: '#ffffff', bgGradient: dark, text: 'POC' })] });
        expect(texts.find(([t]) => t === 'POC')?.[1]).toBe('#ffffff');
    });
});
