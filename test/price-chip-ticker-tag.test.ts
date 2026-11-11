import { describe, it, expect, vi } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import type { OHLCV } from '../src/core/model/ohlcv';

// The current-price chip wears the market's symbol as a ticker tag beside its price box.
// A chart that was never told its symbol has no tag to wear: the price box stands alone,
// and the price line runs up to it.

/** A 2d-context stand-in that records every text painted and every line segment's ends. */
function recordingCanvas(width: number, height: number) {
    const texts: string[] = [];
    const lineEnds: number[] = [];
    const state: Record<string, unknown> = { font: '', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
    const ctx = new Proxy(state, {
        get(target, key: string) {
            if (key === 'fillText') return (text: string) => texts.push(text);
            if (key === 'lineTo') return (x: number) => lineEnds.push(x);
            if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
            if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) });
            if (key === 'canvas') return { width, height };
            if (key in target) return target[key];
            return () => undefined;
        },
        set(target, key: string, value) {
            target[key] = value;
            return true;
        },
    });
    const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    // The chrome measures text on a scratch canvas it creates itself.
    vi.stubGlobal('document', { createElement: () => canvas });
    return { canvas, texts, lineEnds };
}

const STEP = 60_000;
const BARS: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({ time: i * STEP, open: 100, high: 110, low: 95, close: 100, volume: 1 }));

function paint(symbol: string): { texts: string[]; lineEnds: number[]; dataW: number } {
    const scene = new SceneGraph();
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 400 };
    pane.scale = { min: 90, max: 120 };
    pane.scaleTarget = { min: 90, max: 120 };
    scene.bars = BARS;
    scene.symbol = symbol;
    scene.showPriceLine = true;
    const coords = new CoordinateSystem();
    coords.setSize(800, 400, 1);
    coords.setBars(BARS.map((b) => b.time));
    coords.setViewport({ barSpacing: 10, rightOffset: 2 });
    const { canvas, texts, lineEnds } = recordingCanvas(800, 400);
    const chrome = new ChromeRenderer();
    chrome.mount(canvas);
    chrome.render(scene, coords, DARK_THEME);
    return { texts, lineEnds, dataW: coords.width };
}

describe('the current-price chip\'s ticker tag', () => {
    it('is the market symbol without its provider prefix', () => {
        const { texts } = paint('binance:btcusdt');
        expect(texts).toContain('$BTCUSDT');
    });

    it('is left out when the chart has no symbol, and the price box stays', () => {
        const tagged = paint('binance:btcusdt').texts;
        const bare = paint('').texts;
        expect(bare.filter((t) => t.startsWith('$'))).toEqual([]);
        // Everything else paints as it does with a tag, the price box included.
        expect(bare).toEqual(tagged.filter((t) => t !== '$BTCUSDT'));
    });

    it('lets the price line reach the price box when there is no tag', () => {
        const tagged = paint('binance:btcusdt');
        const bare = paint('');
        // The tagged line stops short of the tag ('$BTCUSDT' measures 48 + 8 px here).
        expect(tagged.lineEnds).toContain(tagged.dataW - 1 - 56);
        expect(tagged.lineEnds).not.toContain(tagged.dataW - 1);
        expect(bare.lineEnds).toContain(bare.dataW - 1);
    });
});
