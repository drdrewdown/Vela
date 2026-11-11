import { describe, it, expect, vi } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { RendererDisplayOptions } from '../src/core/options';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import type { OHLCV } from '../src/core/model/ohlcv';

// The current-price chip wears the market's symbol as a ticker tag beside its price box.
// A chart that was never told its symbol has no tag to wear: the price box stands alone,
// and the price line runs up to it. A host may name the market itself (`priceAxis.symbolTag`).

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

const DISPLAY: RendererDisplayOptions = {
    currentPriceLine: true,
    logScale: false,
    nativeBackend: 'auto',
    animZoom: 0,
    animPan: 0,
    animScroll: 0,
    animAutoscale: 0,
    animLiveBar: 0,
    animIntro: { style: false, duration: 0 },
    glow: 0,
    upColor: '#0f0',
    downColor: '#f00',
    priceStyle: 'candles',
};

const STEP = 60_000;
const BARS: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({ time: i * STEP, open: 100, high: 110, low: 95, close: 100, volume: 1 }));

function paint(symbol: string, symbolTag: string | null = null): { texts: string[]; lineEnds: number[]; dataW: number } {
    const scene = new SceneGraph();
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 400 };
    pane.scale = { min: 90, max: 120 };
    pane.scaleTarget = { min: 90, max: 120 };
    scene.bars = BARS;
    scene.symbol = symbol;
    scene.symbolTag = symbolTag;
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
    it('is the market symbol without its provider prefix, as given', () => {
        expect(paint('binance:BTCUSDT').texts).toContain('BTCUSDT');
        expect(paint('binance:btcusdt').texts).toContain('btcusdt');
    });

    it('is the host\'s name for the market when it gave one', () => {
        const { texts } = paint('binance:BTCUSDT', 'Bitcoin');
        expect(texts).toContain('Bitcoin');
        expect(texts).not.toContain('BTCUSDT');
    });

    it('is left out when the host names the market with an empty string', () => {
        expect(paint('binance:BTCUSDT', '').texts).toEqual(paint('').texts);
    });

    it('is left out when the chart has no symbol, and the price box stays', () => {
        const tagged = paint('binance:BTCUSDT').texts;
        const bare = paint('').texts;
        // Everything else paints as it does with a tag, the price box included.
        expect(bare).toEqual(tagged.filter((t) => t !== 'BTCUSDT'));
    });

    it('lets the price line reach the price box when there is no tag', () => {
        const tagged = paint('binance:BTCUSDT');
        const bare = paint('');
        // The tagged line stops short of the tag ('BTCUSDT' measures 42 + 8 px here).
        expect(tagged.lineEnds).toContain(tagged.dataW - 1 - 50);
        expect(tagged.lineEnds).not.toContain(tagged.dataW - 1);
        expect(bare.lineEnds).toContain(bare.dataW - 1);
    });
});

describe('the `priceAxisSymbolTag` feature', () => {
    const tagOf = (r: NativeRenderer): string | null => (r as unknown as { scene: SceneGraph }).scene.symbolTag;

    it('names every symbol the chart is handed, with its provider prefix', () => {
        const seen: string[] = [];
        const r = new NativeRenderer();
        r.applyFeature('priceAxisSymbolTag', (symbol: string) => { seen.push(symbol); return `#${symbol.split(':')[1]}`; });
        r.setMarketSymbol('binance:BTCUSDT');
        expect(tagOf(r)).toBe('#BTCUSDT');
        r.setMarketSymbol('binance:ETHUSDT');
        expect(tagOf(r)).toBe('#ETHUSDT');
        expect(seen).toEqual(['binance:BTCUSDT', 'binance:ETHUSDT']);
    });

    it('renames the current symbol when it is set or cleared', () => {
        const r = new NativeRenderer();
        r.setMarketSymbol('binance:BTCUSDT');
        expect(tagOf(r)).toBeNull();
        r.applyFeature('priceAxisSymbolTag', () => 'Bitcoin');
        expect(tagOf(r)).toBe('Bitcoin');
        expect(r.readFeature('priceAxisSymbolTag')).toBeTypeOf('function');
        r.applyFeature('priceAxisSymbolTag', null);
        expect(tagOf(r)).toBeNull();
    });

    it('keeps the built-in tag when the function returns nothing or throws', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r = new NativeRenderer();
        r.setMarketSymbol('binance:BTCUSDT');
        r.applyFeature('priceAxisSymbolTag', () => null);
        expect(tagOf(r)).toBeNull();
        r.applyFeature('priceAxisSymbolTag', () => { throw new Error('no'); });
        expect(tagOf(r)).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('is seeded from the display options', () => {
        const r = new NativeRenderer({ ...DISPLAY, priceAxisSymbolTag: (symbol) => symbol.toUpperCase() });
        r.setMarketSymbol('binance:btcusdt');
        expect(tagOf(r)).toBe('BINANCE:BTCUSDT');
    });
});
