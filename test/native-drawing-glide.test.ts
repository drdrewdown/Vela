// Drawing glide: an indicator line, box or label emitted with `glide: true` eases its prices
// toward a later run's values (same id) on the forming bar's clock (`animations.liveBar`)
// instead of jumping. Bar positions and everything else take the new run at once; a drawing
// seen for the first time snaps; with the live-bar glide off nothing animates.
import { describe, it, expect } from 'vitest';
import { DrawingGlide } from '../src/renderers/native/core/DrawingGlide';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { resolveAnimations } from '../src/core/options';
import type { DrawingBox, DrawingLabel, DrawingLine } from '../src/core/model/drawings';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/engine/EngineOrchestrator';

const box = (top: number, bottom: number, right: number, glide = true): DrawingBox => ({
    id: 'body', paneId: '', xloc: 'bar_index', left: 10, right, top, bottom, extend: 'none', borderWidth: 1, borderStyle: 'solid',
    textSize: 'tiny', hAlign: 'center', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false, glide,
});
const line = (y: number): DrawingLine => ({
    id: 'wick', paneId: '', xloc: 'bar_index', x1: 12, y1: y, x2: 12, y2: y - 4, extend: 'none', invisible: false, width: 1,
    style: 'solid', arrowLeft: false, arrowRight: false, glide: true,
});
const label = (y: number): DrawingLabel => ({ id: 'delta', paneId: '', xloc: 'bar_index', x: 12, y, yloc: 'price', style: 'none', size: 'tiny', glide: true });
const model = (b: DrawingBox[], l: DrawingLine[] = [], lb: DrawingLabel[] = []): IndicatorModel =>
    ({ id: 'ind', title: 'HTF candles', overlay: true, paneHint: 'price', series: [], boxes: b, lines: l, labels: lb }) as unknown as IndicatorModel;

describe('DrawingGlide', () => {
    it('a first emission snaps; a moved price eases from where it was and settles on the new one', () => {
        const g = new DrawingGlide();
        expect(g.retarget(model([box(110, 100, 20)]), 90)).toBe(false);
        const next = model([box(120, 100, 21)]);
        expect(g.retarget(next, 90)).toBe(true);
        const shown = next.boxes![0]!;
        expect(shown.top).toBe(110);             // painted where it was…
        expect(shown.right).toBe(21);            // …while its bar position takes the new run at once
        expect(g.step(16, 90)).toBe(true);
        expect(shown.top).toBeGreaterThan(110);
        expect(shown.top).toBeLessThan(120);
        let frames = 1;
        while (g.step(16, 90) && frames < 400) frames += 1;
        expect(frames).toBeLessThan(400);
        expect(shown.top).toBe(120);
        expect(shown.bottom).toBe(100);
    });

    it('lines and labels glide too, each on its own prices', () => {
        const g = new DrawingGlide();
        g.retarget(model([], [line(50)], [label(40)]), 90);
        const next = model([], [line(60)], [label(30)]);
        expect(g.retarget(next, 90)).toBe(true);
        expect(next.lines![0]!.y1).toBe(50);
        expect(next.lines![0]!.y2).toBe(46);
        expect(next.labels![0]!.y).toBe(40);
        while (g.step(16, 90));
        expect([next.lines![0]!.y1, next.lines![0]!.y2, next.labels![0]!.y]).toEqual([60, 56, 30]);
    });

    it('a drawing without glide, and every drawing with the live-bar glide off, jumps', () => {
        const g = new DrawingGlide();
        g.retarget(model([box(110, 100, 20, false)]), 90);
        const plain = model([box(120, 100, 20, false)]);
        expect(g.retarget(plain, 90)).toBe(false);
        expect(plain.boxes![0]!.top).toBe(120);
        g.retarget(model([box(110, 100, 20)]), 0);
        const off = model([box(120, 100, 20)]);
        expect(g.retarget(off, 0)).toBe(false);
        expect(off.boxes![0]!.top).toBe(120);
        expect(g.step(16, 0)).toBe(false);
    });

    it('a retarget mid-glide continues from the painted price, never from the stale target', () => {
        const g = new DrawingGlide();
        g.retarget(model([box(110, 100, 20)]), 90);
        g.retarget(model([box(120, 100, 20)]), 90);
        g.step(16, 90);
        const mid = model([box(130, 100, 20)]);
        g.retarget(mid, 90);
        expect(mid.boxes![0]!.top).toBeGreaterThan(110);
        expect(mid.boxes![0]!.top).toBeLessThan(120);
    });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- the scene and animator are private by design; the test reads them */
describe('NativeRenderer drawing glide', () => {
    function makeRenderer(animLiveBar: number) {
        const r = new NativeRenderer({
            currentPriceLine: true, logScale: false, nativeBackend: 'canvas2d', ...resolveAnimations({ liveBar: animLiveBar }),
            glow: 0, upColor: '#0f0', downColor: '#f00', priceStyle: 'candles',
        });
        const anyR = r as any;
        let starts = 0;
        anyR.scheduler = { invalidate: () => {} };
        anyR.animator = { active: false, start: () => { starts += 1; }, stop: () => {} };
        anyR.scene.indicators.set('ind', model([box(110, 100, 20)]));
        return { r, anyR, starts: () => starts };
    }
    const patch = (b: DrawingBox): ScenePatch => ({ kind: 'value', series: [], boxes: [b] }) as unknown as ScenePatch;

    it('a value patch that moves a glide drawing starts the animator, and the frame tick eases it', () => {
        const { r, anyR, starts } = makeRenderer(90);
        r.updateIndicator({ id: 'ind' } as any, patch(box(110, 100, 20)));
        expect(starts()).toBe(0);
        r.updateIndicator({ id: 'ind' } as any, patch(box(120, 100, 20)));
        expect(starts()).toBe(1);
        const shown = anyR.scene.indicators.get('ind').boxes[0];
        expect(shown.top).toBe(110);
        expect(anyR.drawingGlide.step(16, 90)).toBe(true);
        expect(shown.top).toBeGreaterThan(110);
    });

    it('with the live-bar glide off a patch never starts the animator', () => {
        const { r, anyR, starts } = makeRenderer(0);
        r.updateIndicator({ id: 'ind' } as any, patch(box(110, 100, 20)));
        r.updateIndicator({ id: 'ind' } as any, patch(box(120, 100, 20)));
        expect(starts()).toBe(0);
        expect(anyR.scene.indicators.get('ind').boxes[0].top).toBe(120);
    });
});
