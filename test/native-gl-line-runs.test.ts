// @vitest-environment jsdom
// The animator paints a data frame at every vsync while anything moves (the live candle's glide
// alone keeps it running), and the WebGL2 backend re-tessellated every line series on each of
// those frames although a line's vertices only move with the view, its pane's scale and bounds,
// its style, the batch alpha and the values and colours of the points it reads. A line whose
// inputs held is replayed from the vertices it was last built into, and a replayed frame uploads
// exactly what a fresh backend builds for the same scene. A line that changes every frame (its
// scale gliding, its last point moving) pays little beyond the rebuild it always paid: what a
// run records grows with how long its inputs hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGL2Backend } from '../src/renderers/native/backend/WebGL2Backend';
import { Batch } from '../src/renderers/native/backend/gl/Batch';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { LineLikeSeries, SeriesPoint } from '../src/core/model/series';
import { DARK_THEME } from '../src/core/theme';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

interface Upload {
    pass: 'main' | 'glow';
    floats: number[];
}

let uploads: Upload[] = [];

/** A WebGL2 context whose enums are numbers and which records only the per-frame vertex
 *  uploads (`bufferData(ARRAY_BUFFER, …, DYNAMIC_DRAW)`), tagged by the pass that made them:
 *  the glow pass draws into a framebuffer, the main pass into the canvas. */
function fakeGl(): WebGL2RenderingContext {
    const enums = new Map<string, number>();
    const enumOf = (name: string): number => {
        let v = enums.get(name);
        if (v === undefined) {
            v = 0x1000 + enums.size;
            enums.set(name, v);
        }
        return v;
    };
    let framebuffer: unknown = null;
    const known: Record<string, unknown> = {
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        isContextLost: () => false,
        getExtension: () => null,
        getUniformLocation: () => ({}),
        bindFramebuffer: (_target: number, fbo: unknown) => { framebuffer = fbo; },
        bufferData: (target: number, data: Float32Array, usage: number) => {
            if (target === enumOf('ARRAY_BUFFER') && usage === enumOf('DYNAMIC_DRAW')) uploads.push({ pass: framebuffer ? 'glow' : 'main', floats: Array.from(data) });
        },
    };
    const gl = new Proxy(known, {
        get: (t, k: string) => {
            if (k in t) return t[k];
            if (/^[A-Z][A-Z0-9_]*$/.test(k)) return enumOf(k);
            if (k.startsWith('create')) return () => ({});
            return () => undefined;
        },
    });
    return gl as unknown as WebGL2RenderingContext;
}

let segs: ReturnType<typeof vi.spyOn>;
let circles: ReturnType<typeof vi.spyOn>;
let appends: ReturnType<typeof vi.spyOn>;
let copies: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    uploads = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeGl() as unknown as RenderingContext);
    segs = vi.spyOn(Batch.prototype, 'seg');
    circles = vi.spyOn(Batch.prototype, 'circle');
    appends = vi.spyOn(Batch.prototype, 'append');
    copies = vi.spyOn(Batch.prototype, 'floatsSince');
});

afterEach(() => vi.restoreAllMocks());

/** A sine wave over the bars; `zigzag` instead bends at every bar, so every bar adds a join. */
const SINE = (i: number): number => 50 + 10 * Math.sin(i / 7);
const ZIGZAG = (i: number): number => (i % 2 === 0 ? 40 : 60);

function setup(kind: LineLikeSeries['kind'] = 'line', { bars = 200, barSpacing = 8, wave = SINE } = {}) {
    const scene = new SceneGraph();
    const osc = scene.ensurePane('osc', 'study', 1);
    osc.bounds = { top: 0, height: 300 };
    osc.scale = { min: 30, max: 70 };
    const times = Array.from({ length: bars }, (_, i) => T0 + i * MIN);
    scene.bars = times.map((time) => ({ time, open: 50, high: 60, low: 40, close: 55, volume: 1 }));
    // a plot shifted forward: five points past the last bar, into the right whitespace
    const line: LineLikeSeries = {
        id: 'osc-line', title: 'Osc', paneId: 'osc', kind,
        points: Array.from({ length: bars + 5 }, (_, i) => ({ time: T0 + i * MIN, value: wave(i) })),
        style: { color: '#3366cc', width: 2, lineStyle: 'solid' },
    };
    const model = { id: 'ind', title: 'Ind', overlay: false, paneHint: 'osc', paneId: 'osc', series: [line], fills: [], backgrounds: [], priceLines: [] } as unknown as IndicatorModel;
    scene.indicators.set(model.id, model);
    scene.assignIndicatorZ(model.id);
    const coords = new CoordinateSystem();
    coords.setSize(735, 300, 1);
    coords.setBars(times);
    coords.setViewport({ barSpacing, rightOffset: 5 });
    const look = { alpha: 1, glow: 0 };
    const mount = (): WebGL2Backend => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 300;
        const backend = new WebGL2Backend();
        backend.mount(canvas);
        return backend;
    };
    /** Paint one frame: how many segments and fans it tessellated, and what it uploaded. */
    const frame = (backend: WebGL2Backend) => {
        backend.modelAlpha = look.alpha;
        backend.glow = look.glow;
        uploads = [];
        const before = segs.mock.calls.length + circles.mock.calls.length;
        backend.render(scene, coords, DARK_THEME);
        return { built: segs.mock.calls.length + circles.mock.calls.length - before, uploads };
    };
    /** What a backend that never painted before uploads for the same scene. */
    const fresh = () => frame(mount()).uploads;
    /** Paint the frames that bring an unchanged line to a replay: the first records its inputs,
     *  the second copies its points, the third keeps its vertices. */
    const settle = (backend: WebGL2Backend) => [frame(backend), frame(backend), frame(backend)];
    /** Count, per point, how often a frame reads it. */
    const reads = new Map<number, number>();
    const countReads = () => {
        line.points = new Proxy<SeriesPoint[]>(line.points, {
            get: (t, k, r) => {
                if (typeof k === 'string' && /^\d+$/.test(k)) reads.set(+k, (reads.get(+k) ?? 0) + 1);
                return Reflect.get(t, k, r);
            },
        });
    };
    /** Paint one frame and report the most times it read any one point. */
    const mostReads = (backend: WebGL2Backend) => {
        reads.clear();
        const painted = frame(backend);
        return { ...painted, most: Math.max(...reads.values()) };
    };
    /** The bars the backend walks this frame: i0, and s1 — the last slot the view shows. */
    const walk = () => {
        const vr = coords.visibleLogicalRange();
        return { i0: Math.max(0, Math.floor(vr.from)), s1: Math.ceil(vr.to), off: scene.offsetOf(model.id) };
    };
    return { scene, osc, line, model, coords, look, mount, frame, fresh, settle, countReads, mostReads, walk };
}

describe('WebGL2Backend — a line whose inputs held is replayed, not rebuilt', () => {
    it('replays a line whose inputs are unchanged, and builds none of it', () => {
        const s = setup();
        const warm = s.mount();
        const first = s.frame(warm);
        expect(first.built).toBeGreaterThan(0);
        expect(first.uploads.map((u) => u.pass)).toEqual(['main']);
        for (let k = 0; k < 5; k++) {
            const next = s.frame(warm);
            if (k > 1) expect(next.built).toBe(0);
            expect(next.uploads).toEqual(first.uploads);
        }
        s.osc.scale = { ...s.osc.scale }; // the animator re-allocates the scale every frame
        expect(s.frame(warm)).toEqual({ built: 0, uploads: first.uploads });
    });

    it('a frame on which the scale glides reads each point only as its build does', () => {
        const s = setup();
        const warm = s.mount();
        s.settle(warm);
        s.countReads();
        for (let k = 0; k < 3; k++) {
            s.osc.scale = { min: s.osc.scale.min + 0.5, max: s.osc.scale.max };
            const glide = s.mostReads(warm);
            expect(glide.built).toBeGreaterThan(0);
            // the build reads a point as the bar it draws, the bar before and the bar after: no copy
            expect(glide.most).toBe(3);
        }
        const after = [s.mostReads(warm), s.mostReads(warm), s.mostReads(warm)];
        expect(after.map((f) => f.built > 0)).toEqual([true, true, false]); // copies the points, keeps, replays
        expect(after.map((f) => f.most)).toEqual([4, 4, 1]);
        expect(after[2]!.uploads).toEqual(s.fresh());
    });

    it('a line whose last point moves every frame is rebuilt, and checked from that point', () => {
        const s = setup();
        const warm = s.mount();
        s.settle(warm);
        s.countReads();
        const { s1, off } = s.walk();
        const tail = s.line.points[s1 - off]!;
        for (let k = 0; k < 4; k++) {
            tail.value = 50 + k;
            const tick = s.mostReads(warm);
            expect(tick.built).toBeGreaterThan(0);
            // the build's three reads and one copy: the check stops at the point that moved
            expect(tick.most).toBe(4);
            expect(tick.uploads).toEqual(s.fresh());
        }
        expect(s.mostReads(warm)).toMatchObject({ most: 4 }); // the points held: kept
        const kept = s.mostReads(warm);
        expect(kept).toMatchObject({ built: 0, most: 1 });
        expect(kept.uploads).toEqual(s.fresh());
    });

    it('a replayed frame is the frame a fresh backend paints, for every input that moves a vertex', () => {
        const s = setup();
        const warm = s.mount();
        s.settle(warm);
        let last = s.frame(warm);
        expect(last.built).toBe(0);
        const point = (i: number) => s.line.points[i]!;
        const changes: Array<[string, () => void]> = [
            ['a point\'s value edited in place', () => { point(195).value = 61; }],
            ['a point recoloured in place', () => { point(190).color = '#aa5500'; }],
            ['a point swapped for a new object of another value', () => { s.line.points[180] = { ...point(180), value: 41 }; }],
            ['a gap', () => { point(170).value = null; }],
            ['a value an untyped producer left undefined, not null', () => { Object.assign(point(170), { value: undefined }); }],
            ['the gap filled again', () => { point(170).value = 47; }],
            ['the point at the right edge of the view changes', () => { const { s1, off } = s.walk(); point(s1 - off).value = 44; }],
            ['the first point the view reads changes', () => { const { i0, off } = s.walk(); point(Math.max(1, i0 - 1) - 1 - off).value = 58; }],
            ['the scale glides at its bottom', () => { s.osc.scale = { ...s.osc.scale, min: 31 }; }],
            ['the scale glides at its top', () => { s.osc.scale = { ...s.osc.scale, max: 69 }; }],
            ['the scale inverts', () => { s.osc.scale = { ...s.osc.scale, invert: true }; }],
            ['the scale turns logarithmic', () => { s.osc.scale = { ...s.osc.scale, log: true }; }],
            ['the pane moves down', () => { s.osc.bounds = { top: 20, height: 300 }; }],
            ['the pane is resized', () => { s.osc.bounds = { top: 20, height: 280 }; }],
            ['the view scrolls by a fraction of a bar', () => s.coords.setViewport({ barSpacing: 8, rightOffset: 4.9 })],
            ['the view zooms a hair', () => s.coords.setViewport({ barSpacing: 8.01, rightOffset: 4.9 })],
            ['the scale docks left by one pixel', () => s.coords.setSize(735, 300, 1, 1)],
            ['the gutter widens by what the plot narrows', () => s.coords.setSize(728, 300, 1, 8)],
            ['the view returns', () => { s.coords.setSize(735, 300, 1); s.coords.setViewport({ barSpacing: 8, rightOffset: 5 }); }],
            ['the bars spread apart', () => s.coords.setPitchScale(1.5)],
            ['a new bar opens', () => s.coords.appendBar(T0 + 200 * MIN)],
            ['the line widens', () => { s.line.style.width = 3; }],
            ['the line turns dashed', () => { s.line.style.lineStyle = 'dashed'; }],
            ['the line is recoloured', () => { s.line.style.color = '#884422'; }],
            ['the line becomes a step line', () => { s.line.kind = 'step'; }],
            ['the models fade', () => { s.look.alpha = 0.5; }],
            // a flat line reads the same values wherever its window starts: the offset moves a vertex
            // only where the window meets the end of the series, a slot that held a point and now holds none
            ['the line is flattened', () => { for (const p of s.line.points) p.value = 50; }],
            ['the model\'s index offset changes', () => s.scene.setAnchorOffset('ind', 3)],
        ];
        for (const [what, change] of changes) {
            change();
            const after = s.frame(warm);
            expect(after.built, what).toBeGreaterThan(0);
            expect(after.uploads, what).not.toEqual(last.uploads); // the change does move a vertex
            expect(after.uploads, what).toEqual(s.fresh());
            expect(s.frame(warm).uploads, what).toEqual(after.uploads);
            expect(s.frame(warm).uploads, what).toEqual(after.uploads);
            last = s.frame(warm);
            expect(last, what).toEqual({ built: 0, uploads: after.uploads });
        }
    });

    it('keeps a line whose inputs are equal, whatever objects carry them', () => {
        const s = setup();
        const warm = s.mount();
        const first = s.settle(warm)[0]!;
        const unchanged: Array<[string, () => void]> = [
            ['a point swapped for an equal new object', () => { s.line.points[195] = { ...s.line.points[195]! }; }],
            ['the points swapped for an equal new array', () => { s.line.points = s.line.points.map((p) => ({ ...p })); }],
            ['the pane scale re-allocated', () => { s.osc.scale = { min: 30, max: 70 }; }],
            ['a point before the first one the view reads changes', () => { const { i0, off } = s.walk(); s.line.points[Math.max(1, i0 - 1) - 2 - off]!.value = 12; }],
            ['a point past the right edge of the view changes', () => { const { s1, off } = s.walk(); s.line.points[s1 + 1 - off] = { time: T0 + (s1 + 1) * MIN, value: 33 }; }],
        ];
        for (const [what, change] of unchanged) {
            change();
            expect(s.frame(warm), what).toEqual({ built: 0, uploads: first.uploads });
        }
    });

    it('keeps a line on a manual scale the renderer copies every frame', () => {
        const s = setup();
        s.osc.manualScale = { min: 35, max: 65 };
        const warm = s.mount();
        const frames = Array.from({ length: 4 }, () => {
            s.osc.scale = { ...s.osc.manualScale! };
            return s.frame(warm);
        });
        expect(frames[3]).toEqual({ built: 0, uploads: frames[0]!.uploads });
        expect(frames[3]!.uploads).toEqual(s.fresh());
    });

    it('keeps the line of a merged model drawn on its own scale', () => {
        const s = setup();
        Object.assign(s.model, { ownScale: true });
        s.scene.ensureIndicatorScale('ind', { min: 20, max: 80 });
        const warm = s.mount();
        const frames = Array.from({ length: 4 }, () => {
            s.scene.indicatorScales.get('ind')!.scale = { min: 20, max: 80 }; // eased into a new object every frame
            return s.frame(warm);
        });
        expect(frames[3]).toEqual({ built: 0, uploads: frames[0]!.uploads });
        expect(frames[3]!.uploads).toEqual(s.fresh());
        s.osc.scale = { min: 10, max: 90 }; // the pane's own scale is not the one the line reads
        expect(s.frame(warm).built).toBe(0);
    });

    it('keeps an area\'s line over its band, in the place a fresh backend draws it', () => {
        const s = setup('area');
        const warm = s.mount();
        s.settle(warm);
        const kept = s.frame(warm);
        expect(kept.built).toBe(0);
        expect(kept.uploads).toEqual(s.fresh());
    });

    it('the glow pass keeps its own runs, for a merged model\'s line too', () => {
        const s = setup();
        Object.assign(s.model, { ownScale: true });
        s.scene.ensureIndicatorScale('ind', { min: 20, max: 80 });
        s.look.glow = 0.5;
        const warm = s.mount();
        s.settle(warm);
        const kept = s.frame(warm);
        expect(kept.built).toBe(0);
        expect(kept.uploads.map((u) => u.pass)).toEqual(['main', 'glow']);
        expect(kept.uploads).toEqual(s.fresh());
    });

    it('a line too long to keep is built every frame, as a fresh backend paints it, and kept again once it fits', () => {
        const s = setup('line', { bars: 2000, barSpacing: 735 / 2010, wave: ZIGZAG });
        const warm = s.mount();
        const frames = [...s.settle(warm), s.frame(warm), s.frame(warm)];
        expect(frames[0]!.uploads[0]!.floats.length).toBeGreaterThan(1 << 18); // more than a run keeps (1 MiB)
        expect(frames.map((f) => f.built > 0)).toEqual([true, true, true, true, true]);
        expect(appends).not.toHaveBeenCalled();
        expect(frames[4]!.uploads).toEqual(s.fresh());
        s.coords.setViewport({ barSpacing: 8, rightOffset: 5 }); // zoomed in: a hundred bars
        const zoomed = [...s.settle(warm), s.frame(warm)];
        expect(zoomed.map((f) => f.built > 0)).toEqual([true, true, true, false]);
        expect(zoomed[3]!.uploads).toEqual(s.fresh());
    });

    it('a line too long to keep is built with no check of its points and no copy of its vertices', () => {
        const s = setup('line', { bars: 2000, barSpacing: 735 / 2010, wave: ZIGZAG });
        const warm = s.mount();
        s.settle(warm);
        s.countReads();
        copies.mockClear();
        for (let k = 0; k < 3; k++) expect(s.mostReads(warm)).toMatchObject({ most: 3 });
        expect(copies).not.toHaveBeenCalled();
    });

    it('a line too long to keep is never checked or copied after its inputs move, from the first frame', () => {
        const s = setup('line', { bars: 2000, barSpacing: 735 / 2010, wave: ZIGZAG });
        const warm = s.mount();
        s.settle(warm);
        s.countReads();
        copies.mockClear();
        s.osc.scale = { min: s.osc.scale.min + 0.5, max: s.osc.scale.max };
        const frames = [s.mostReads(warm), s.mostReads(warm), s.mostReads(warm)];
        expect(frames.map((f) => f.most)).toEqual([3, 3, 3]);
        expect(copies).not.toHaveBeenCalled();
        expect(frames[2]!.uploads).toEqual(s.fresh());
    });

    it('a kept line\'s store follows it down when it shrinks', () => {
        const s = setup();
        const warm = s.mount();
        s.settle(warm);
        s.coords.setViewport({ barSpacing: 60, rightOffset: 5 }); // zoomed in: a tenth of the bars
        s.settle(warm);
        appends.mockClear();
        const kept = s.frame(warm);
        expect(kept.built).toBe(0);
        expect(kept.uploads).toEqual(s.fresh());
        const replayed = appends.mock.calls[0]![0] as Float32Array;
        expect(replayed.buffer.byteLength).toBeLessThanOrEqual(Math.ceil(replayed.length * 1.25) * 4);
    });
});
