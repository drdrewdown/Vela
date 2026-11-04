// @vitest-environment jsdom
// The animator paints a data frame at every vsync while anything moves (the live candle's glide
// alone keeps it running), and every indicator drawing slice was cleared, repainted and handed to
// the backend for a fresh texture upload on each of those frames. A slice's pixels depend on its
// models' drawings, the scales and bounds they paint against, the view, the newest bar, the theme
// and the canvas: with those unchanged it keeps its pixels and its version.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndicatorDrawingSlices } from '../src/renderers/native/drawings/IndicatorDrawingSlices';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { DrawingLabel } from '../src/core/model/drawings';
import { DARK_THEME, LIGHT_THEME } from '../src/core/theme';

const T0 = 1_700_000_000_000;
const MIN = 60_000;
let clears = 0;

beforeEach(() => {
    clears = 0;
    // a 2D context that counts clears and takes every other call as a no-op
    const known: Record<string, unknown> = { clearRect: () => { clears++; }, measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) };
    const ctx = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => undefined), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => vi.restoreAllMocks());

const label = (id: string, i: number, over: Partial<DrawingLabel> = {}): DrawingLabel => ({
    id, paneId: '', xloc: 'bar_time', x: T0 + i * MIN, y: 150, yloc: 'price', text: id, style: 'label_up', size: 'normal', textAlign: 'center', fontFamily: 'default', ...over,
});

function setup() {
    const scene = new SceneGraph();
    const price = scene.ensurePane('price', 'price', 0, 3);
    price.bounds = { top: 0, height: 400 };
    price.scale = { min: 100, max: 200 };
    const times = Array.from({ length: 200 }, (_, i) => T0 + i * MIN);
    scene.bars = times.map((time) => ({ time, open: 150, high: 160, low: 140, close: 155, volume: 1 }));
    const model = { id: 'ind', title: 'Ind', overlay: true, paneHint: 'price', paneId: 'price', series: [], fills: [], backgrounds: [], priceLines: [], labels: [label('a', 190, { tooltip: 'tip a' }), label('b', 195, { yloc: 'abovebar', tooltip: 'tip b' })] } as unknown as IndicatorModel;
    scene.indicators.set(model.id, model);
    scene.assignIndicatorZ(model.id);
    const coords = new CoordinateSystem();
    coords.setSize(735, 400, 1);
    coords.setBars(times);
    coords.setViewport({ barSpacing: 8, rightOffset: 5 });
    const ref = document.createElement('canvas');
    ref.width = 800;
    ref.height = 400;
    const slices = new IndicatorDrawingSlices();
    let revision = 0;
    const frame = (theme = DARK_THEME) => {
        const before = clears;
        const out = slices.prepare(scene, coords, theme, ref, () => revision);
        return { painted: clears - before, versions: [...out.values()].flat().map((s) => s.version) };
    };
    /** Every tooltip the last frame left answerable, found by sweeping the plot. */
    const tips = () => {
        const seen = new Set<string>();
        for (let x = 0; x < 800; x += 2) for (let y = 0; y < 400; y += 2) { const t = slices.labelTooltipAt(x, y); if (t) seen.add(t); }
        return [...seen].sort();
    };
    return { scene, price, model, coords, ref, slices, frame, tips, glide: () => { revision++; } };
}

describe('IndicatorDrawingSlices — an unchanged slice keeps its pixels', () => {
    it('repaints nothing, and keeps the version, when no input changed', () => {
        const { frame, tips } = setup();
        const first = frame();
        expect(first.painted).toBeGreaterThan(0);
        const hover = tips();
        expect(hover).toEqual(['tip a', 'tip b']);
        for (let k = 0; k < 5; k++) expect(frame()).toEqual({ painted: 0, versions: first.versions });
        expect(tips()).toEqual(hover); // a kept slice still answers its hovers
    });

    it('repaints a slice whose canvas context was lost and restored, its inputs unchanged', () => {
        const s = setup();
        const slices = [...(s.slices.prepare(s.scene, s.coords, DARK_THEME, s.ref, () => 0)).values()].flat();
        expect(s.frame().painted).toBe(0);
        slices[0]!.canvas.dispatchEvent(new Event('contextrestored'));
        const after = s.frame();
        expect(after.painted).toBeGreaterThan(0);
        expect(after.versions).not.toContain(slices[0]!.version);
    });

    it('repaints once a font load lands, so text a paint drew in a fallback face is redrawn', () => {
        const fonts = new EventTarget();
        Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
        try {
            const s = setup();
            s.frame();
            expect(s.frame().painted).toBe(0);
            fonts.dispatchEvent(new Event('loadingdone'));
            expect(s.frame().painted).toBeGreaterThan(0);
            expect(s.frame().painted).toBe(0);
        } finally {
            delete (document as { fonts?: unknown }).fonts;
        }
    });

    it('repaints, with a new version, for each input that changes its pixels', () => {
        const s = setup();
        let last = s.frame();
        const changes: Array<[string, () => void]> = [
            ['a new emit of its labels', () => { s.model.labels = [...s.model.labels!]; }],
            ['the scale glides', () => { s.price.scale = { min: 101, max: 201 }; }],
            ['the scale inverts', () => { s.price.scale = { ...s.price.scale, invert: true }; }],
            ['the pane is resized', () => { s.price.bounds = { top: 0, height: 380 }; }],
            ['a drawing glides in place', () => s.glide()],
            ['the forming bar makes a new high', () => { s.scene.bars[s.scene.bars.length - 1] = { ...s.scene.bars[s.scene.bars.length - 1]!, high: 170 }; }],
            ['the view scrolls', () => s.coords.setViewport({ barSpacing: 8, rightOffset: 9 })],
            ['the labels merge differently', () => { s.scene.mergeChips = !s.scene.mergeChips; }],
        ];
        for (const [what, change] of changes) {
            change();
            const next = s.frame();
            expect(next.painted, what).toBe(next.versions.length);
            expect(next.versions.some((v) => last.versions.includes(v)), what).toBe(false);
            last = next;
        }
        const themed = s.frame(LIGHT_THEME);
        expect(themed.painted, 'the theme changes').toBe(themed.versions.length);
    });
});
