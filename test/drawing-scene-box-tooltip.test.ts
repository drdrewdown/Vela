import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET } from '../src/renderers/shared/DrawingSceneRenderer';
import type { DrawingBox } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

// Aether: a labelled box's tooltip hit region is its LABEL, not the whole rectangle.

const theme = { fontFamily: 'sans-serif', textColor: '#ddd' } as VelaTheme;

function box(over: Partial<DrawingBox>): DrawingBox {
    return {
        id: 'b1',
        paneId: 'price',
        xloc: 'bar_index',
        left: 0,
        right: 100,
        top: 100,
        bottom: 0,
        extend: 'none',
        bgColor: '#123',
        borderColor: '#456',
        borderWidth: 1,
        borderStyle: 'solid',
        textSize: 'small',
        hAlign: 'right',
        vAlign: 'top',
        wrap: false,
        fontFamily: 'default',
        bold: false,
        italic: false,
        tooltip: 'zone story',
        ...over,
    };
}

function ctx(): CanvasRenderingContext2D {
    return new Proxy({} as Record<string, unknown>, {
        get: (_t, k: string) => (k === 'measureText' ? () => ({ width: 40 }) : () => undefined),
        set: () => true,
    }) as unknown as CanvasRenderingContext2D;
}

function regions(b: DrawingBox, W = 800) {
    const scene = new DrawingSceneRenderer({ timeToLogical: (ms) => ms, barAt: () => null, theme }, { ...EMPTY_DRAWING_SET, boxes: [b] });
    // identity x; y flips so price 100 is at pixel 0 and price 0 at pixel 100
    scene.render(ctx(), W, 400, (l) => l, (p) => 100 - p);
    return scene.labelTipRegions();
}

describe('box tooltip hit region', () => {
    it('a labelled box answers hover on its label only (top-right corner here)', () => {
        const [r] = regions(box({ text: '-BB A' }));
        expect(r).toBeDefined();
        // label is ~40px wide near the right edge, one line tall near the top — not the 100×100 box
        expect(r!.right - r!.left).toBeLessThan(60);
        expect(r!.bottom - r!.top).toBeLessThan(30);
        expect(r!.right).toBeGreaterThan(90);
        expect(r!.top).toBeLessThan(10);
    });

    it('an unlabelled box keeps the whole rectangle', () => {
        const [r] = regions(box({}));
        expect(r).toBeDefined();
        expect(r!.left).toBe(0);
        expect(r!.right).toBe(100);
        expect(r!.top).toBe(0);
        expect(r!.bottom).toBe(100);
    });

    it('a box running past the plot keeps its right-aligned label (and region) at the visible edge', () => {
        const [r] = regions(box({ text: 'BPR', left: 0, right: 1000 }), 500);
        expect(r).toBeDefined();
        expect(r!.right).toBeLessThanOrEqual(500);
        expect(r!.right).toBeGreaterThan(480);
        expect(r!.left).toBeGreaterThan(440);
    });
});
