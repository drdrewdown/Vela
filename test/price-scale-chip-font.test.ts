import { describe, it, expect, vi } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { OHLCV } from '../src/core/model/ohlcv';

// Every chip on the price scale — the current-price pair, the countdown pill, the
// indicator value chips and the visible-range high/low — reads in ONE font. They used
// to step down by one or two pixels from the price chip, which at the layout's default
// size left the smaller ones hard to read.

/** A 2d-context stand-in that records the font active at every fillText. */
function recordingCanvas(width: number, height: number) {
    const texts: Array<{ text: string; font: string }> = [];
    const state: Record<string, unknown> = { font: '', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
    const ctx = new Proxy(state, {
        get(target, key: string) {
            if (key === 'fillText') return (text: string) => texts.push({ text, font: String(target.font) });
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
    return { canvas, texts };
}

const STEP = 60_000;

function bars(n: number): OHLCV[] {
    return Array.from({ length: n }, (_, i) => ({ time: i * STEP, open: 100, high: 110, low: 95, close: 100, volume: 1 }));
}

function lineModel(id: string, value: number, n: number): IndicatorModel {
    return {
        id,
        title: id,
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        series: [{ id: `${id}:line`, title: 'EMA9', paneId: 'price', kind: 'line', points: Array.from({ length: n }, (_, i) => ({ time: i * STEP, value })), style: { color: '#f00', width: 1, lineStyle: 'solid' } }],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

describe('price-scale chips share one font', () => {
    it('the ticker pair, the countdown, an indicator chip and the range chips all paint in the same font', () => {
        const n = 60;
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0, 3);
        pane.bounds = { top: 0, height: 400 };
        pane.scale = { min: 90, max: 120 };
        pane.scaleTarget = { min: 90, max: 120 };
        scene.bars = bars(n);
        scene.symbol = 'aether:MES';
        scene.indicators.set('m', lineModel('m', 105, n));
        const coords = new CoordinateSystem();
        coords.setSize(800, 400, 1);
        coords.setBars(scene.bars.map((b) => b.time));
        coords.setViewport({ barSpacing: 10, rightOffset: 2 });

        const { canvas, texts } = recordingCanvas(800, 400);
        const chrome = new ChromeRenderer();
        chrome.mount(canvas);
        chrome.render(scene, coords, DARK_THEME);

        const chip = (pick: (t: string) => boolean): string => {
            const hit = texts.find((t) => pick(t.text));
            expect(hit, texts.map((t) => t.text).join(' | ')).toBeDefined();
            return hit!.font;
        };
        const fonts = {
            ticker: chip((t) => t === '$MES'),
            indicator: chip((t) => t === 'EMA9'),
            high: chip((t) => t.startsWith('H ')),
            low: chip((t) => t.startsWith('L ')),
            countdown: chip((t) => /^\d+:\d\d$/.test(t)),
        };
        expect(new Set(Object.values(fonts)).size, JSON.stringify(fonts)).toBe(1);
    });
});
