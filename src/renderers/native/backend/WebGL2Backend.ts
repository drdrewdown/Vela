import type { VelaTheme } from '../../../core/options';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { Fill, Background, PriceLine } from '../../../core/model/scene';
import type { SeriesSpec, SeriesPoint, LineLikeSeries, CandleSeries, LineStyle, CandleBarColor } from '../../../core/model/series';
import { isLineLikeSeries, seriesShownOn } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode, DrawingSlice } from '../core/SceneGraph';
import { candleTier, wickWidth, candleGeometry, snapY, aggregateCandleColumns } from './candle-lod';
import { BASELINE_TOP_LINE, BASELINE_BOTTOM_LINE, BASELINE_FILL_ALPHA, BASELINE_FILL_ALPHA_FAR, withAlpha as cssWithAlpha, effectiveCandlePaint } from '../core/chartConfig';
import type { IRenderBackend } from './IRenderBackend';
import { Batch, type RGBA } from './gl/Batch';
import { parseColor } from './gl/color';

const VERT_SRC = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
layout(location=2) in vec2 aEdge;   // (signed perpendicular distance from line center, half-width)
uniform vec2 uRes;
out vec4 vColor;
out vec2 vEdge;
void main() {
    vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
    gl_Position = vec4(clip, 0.0, 1.0);
    vColor = aColor;
    vEdge = aEdge;
}`;

// Flat color for solid geometry (edgeHalf < 0); for line quads, feather the edge analytically:
// coverage falls off over ~1 device pixel (fwidth) around the half-width, independent of MSAA.
const FRAG_SRC = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vEdge;
out vec4 frag;
void main() {
    if (vEdge.y < 0.0) { frag = vColor; return; }
    float aa = fwidth(vEdge.x);
    float cov = clamp((vEdge.y - abs(vEdge.x)) / max(aa, 1e-4) + 0.5, 0.0, 1.0);
    frag = vec4(vColor.rgb, vColor.a * cov);
}`;

// Fullscreen-quad shader for the glow post-process: a separable 5-tap Gaussian
// blur when uDir != 0, or a passthrough × intensity (the additive composite) when
// uDir == 0.
const SCREEN_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCREEN_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;        // blur direction (texel step); (0,0) = composite passthrough
uniform float uIntensity;
out vec4 frag;
void main() {
    if (uDir.x == 0.0 && uDir.y == 0.0) {
        frag = texture(uTex, vUv) * uIntensity;
        return;
    }
    vec2 o1 = uDir * 1.3846153846;
    vec2 o2 = uDir * 3.2307692308;
    vec4 sum = texture(uTex, vUv) * 0.2270270270;
    sum += texture(uTex, vUv + o1) * 0.3162162162;
    sum += texture(uTex, vUv - o1) * 0.3162162162;
    sum += texture(uTex, vUv + o2) * 0.0702702703;
    sum += texture(uTex, vUv - o2) * 0.0702702703;
    frag = sum;
}`;

const DASH: Record<string, readonly [number, number] | null> = {
    solid: null,
    dashed: [6, 4],
    dotted: [2, 3],
};

/** Triangle-fan segment count for a round line join/cap of half-width `hw` (round enough, not over-tessellated). */
function joinSegments(hw: number): number {
    return Math.max(6, Math.min(20, Math.round(hw * 4)));
}

/**
 * Everything but the points that a line's vertices are built from. X reaches the geometry only
 * through `logicalToX(i) = anchorX − (rightEdge − i) · pitch`, so those three numbers stand for
 * the whole horizontal mapping; `first`/`last` are the bars the build walks; Y comes from the
 * scale and the pane bounds; the shape from the style, the step flag and the batch alpha baked
 * into every vertex. The model's index offset needs no place here: the build reads a point only
 * relative to the bar it draws (`points[i − off]`, `points[i − 1 − off]`), so the run's
 * slot-by-slot copy of the points it read already holds all an offset can change.
 */
interface LineInputs {
    anchorX: number;
    rightEdge: number;
    pitch: number;
    first: number;
    last: number;
    min: number;
    max: number;
    log: boolean;
    invert: boolean;
    top: number;
    height: number;
    width: number;
    lineStyle: LineStyle;
    color: string;
    step: boolean;
    alpha: number;
}

/** Marks a slot of a {@link LineRun} snapshot that held no point (before a series starts, past its end). */
const NO_POINT = Symbol('no point');

/**
 * A line series' finished vertices, kept between frames with the inputs they were built from.
 * The points are kept by the value and colour of every entry the build reads — never by array
 * or object identity, since a producer may edit `points` in place, or hand over equal points in
 * new objects.
 *
 * What a run records grows with how long its inputs hold, so a line that changes every frame
 * pays little beyond its rebuild: a frame on which the inputs moved (a scale glide, a pan, a
 * zoom) records only the inputs; the first frame on which they held also copies the points; the
 * next one on which the points held too keeps the vertices; and from then on they are replayed.
 * A frame on which only a point changed copies the points again, so the line is kept on the
 * frame after.
 */
interface LineRun {
    inputs: LineInputs;
    /** Whether `values` and `colors` hold the points read under `inputs`. */
    pointsKept: boolean;
    /** `value` of each entry from `first − 1 − off` to `last − off`, or {@link NO_POINT}. */
    values: Array<number | null | typeof NO_POINT>;
    /** `color` of the same entries. */
    colors: Array<string | undefined | typeof NO_POINT>;
    /** Backing store of `vertices`: grows to fit, and is reallocated when they need under a quarter of it. */
    store: Float32Array;
    /** The kept vertices (an exact-length view of `store`), or null while they are not kept. */
    vertices: Float32Array | null;
    /** The line came out longer than {@link MAX_RUN_FLOATS} under `inputs`: it is built every frame,
     *  with no copy and no check of its points, until the inputs move. */
    oversized: boolean;
}

/**
 * The most floats a run keeps (1 MiB; its store may take a quarter more). A solid line costs 48
 * floats per segment (one quad per dash when dashed, two segments per bar when stepped) plus
 * `24 · joinSegments(w / 2)` — 144 to 480 — per round join or cap, so this holds some 1,300 bars
 * of a thin line with a join at every bar. A longer one is built every frame while its inputs
 * hold, as if it were not kept, with no copy and no check of its points.
 */
const MAX_RUN_FLOATS = 1 << 18;

const NO_FLOATS = new Float32Array(0);

function sameLineInputs(a: LineInputs, b: LineInputs): boolean {
    return Object.is(a.anchorX, b.anchorX) && Object.is(a.rightEdge, b.rightEdge) && Object.is(a.pitch, b.pitch)
        && a.first === b.first && a.last === b.last
        && Object.is(a.min, b.min) && Object.is(a.max, b.max) && a.log === b.log && a.invert === b.invert
        && Object.is(a.top, b.top) && Object.is(a.height, b.height)
        && Object.is(a.width, b.width) && a.lineStyle === b.lineStyle && a.color === b.color
        && a.step === b.step && Object.is(a.alpha, b.alpha);
}

/**
 * Whether `points` from index `from` still hold the values and colours the run copied. Walks from
 * the last entry back, since a live series changes at its end: a moving last point fails at once.
 */
function samePoints(run: LineRun, points: readonly SeriesPoint[], from: number): boolean {
    const { values, colors } = run;
    for (let j = values.length - 1; j >= 0; j -= 1) {
        const p = points[from + j];
        if (!p) {
            if (values[j] !== NO_POINT) return false;
        } else if (!Object.is(p.value, values[j]) || p.color !== colors[j]) {
            return false;
        }
    }
    return true;
}

function keepPoints(run: LineRun, points: readonly SeriesPoint[], from: number, count: number): void {
    const { values, colors } = run;
    values.length = count;
    colors.length = count;
    for (let j = 0; j < count; j += 1) {
        const p = points[from + j];
        values[j] = p ? p.value : NO_POINT;
        colors[j] = p ? p.color : NO_POINT;
    }
}

/** Keep the vertices `b` took since `mark`, or mark the run oversized when there are too many to keep. */
function keepVertices(run: LineRun, b: Batch, mark: number): void {
    const n = b.floatCount - mark;
    if (n > MAX_RUN_FLOATS) {
        run.oversized = true;
        run.pointsKept = false;
        run.values.length = 0;
        run.colors.length = 0;
        run.store = NO_FLOATS;
        run.vertices = null;
        return;
    }
    if (run.store.length < n || n < run.store.length / 4) run.store = new Float32Array(Math.ceil(n * 1.25));
    run.store.set(b.floatsSince(mark));
    run.vertices = run.store.subarray(0, n);
}

/**
 * Hand-rolled WebGL2 GEOMETRY backend (L0). Same `IRenderBackend` seam as the
 * canvas2d backend: it consumes the retained scene + coordinate system and draws
 * bgcolor + fills + candles + series + hline — everything else stays on canvas2d
 * layers: axes, drawings and the crosshair on the chrome/cursor layers above, the
 * grid + session highlights on the backdrop canvas below (BackdropRenderer).
 *
 * Design: ONE per-vertex-color triangle pipeline. Every primitive decomposes into
 * colored triangles (rects, quads, line-quads, fans) in CSS-pixel space; a vertical
 * gradient is just a quad with different top/bottom vertex colors. Geometry is built
 * each frame culled to the visible bar range (bounded by visible bars, not total)
 * and drawn per pane with gl.scissor. Selected at runtime when WebGL2 is available;
 * the canvas2d backend is the permanent fallback.
 */
export class WebGL2Backend implements IRenderBackend {
    readonly kind = 'webgl2' as const;
    modelAlpha = 1;
    candleBodyAlpha = 1;
    candleStructureAlpha = 1;
    candleBodyScale = 1;
    /** Set by the renderer; invoked after a context restore to request a repaint. */
    onNeedsRedraw: (() => void) | null = null;
    /** Set by the renderer; invoked when the GL context is permanently unusable
     *  (a restore couldn't reinitialize) so it can fall back to canvas2d. */
    onContextFailed: (() => void) | null = null;
    /** Neon glow/bloom intensity for line series (0 = off). Set by the renderer. */
    glow = 0;

    private canvas: HTMLCanvasElement | null = null;
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private vbo: WebGLBuffer | null = null;
    private uRes: WebGLUniformLocation | null = null;
    private readonly batch = new Batch();
    private contextLost = false;

    // glow/bloom post-process (lazy; only when glow > 0)
    private screenProgram: WebGLProgram | null = null;
    private uTex: WebGLUniformLocation | null = null;
    private uDir: WebGLUniformLocation | null = null;
    private uIntensity: WebGLUniformLocation | null = null;
    private quadVao: WebGLVertexArrayObject | null = null;
    private quadVbo: WebGLBuffer | null = null;
    private fboA: WebGLFramebuffer | null = null;
    private texA: WebGLTexture | null = null;
    private fboB: WebGLFramebuffer | null = null;
    private texB: WebGLTexture | null = null;
    private fboW = 0;
    private fboH = 0;
    private readonly glowBatch = new Batch();
    /** One texture per user-drawing interleave layer, keyed by its (stable, reused) canvas;
     *  re-uploaded every data frame — the layer repaints with the scene. */
    private readonly sliceTex = new Map<HTMLCanvasElement, WebGLTexture>();
    /** The slice version each texture holds: an unchanged slice is drawn without re-uploading. */
    private readonly sliceTexVersion = new Map<HTMLCanvasElement, number>();
    /** Each line series' kept vertices (see {@link emitPolylineRun}). */
    private readonly lineRuns = new WeakMap<LineLikeSeries, LineRun>();
    /** The glow pass keeps its own runs: it draws every series against its pane's scale, a
     *  merged (own-scale) model's included, so such a line has other inputs there than in the
     *  main pass, and a run the two passes shared would never hold for it. */
    private readonly glowLineRuns = new WeakMap<LineLikeSeries, LineRun>();
    /** Scratch for the inputs of the line being emitted (reused, so a kept line allocates nothing). */
    private readonly lineInputs: LineInputs = {
        anchorX: 0, rightEdge: 0, pitch: 0, first: 0, last: 0,
        min: 0, max: 0, log: false, invert: false, top: 0, height: 0,
        width: 0, lineStyle: 'solid', color: '', step: false, alpha: 0,
    };

    private readonly onLost = (e: Event): void => {
        e.preventDefault(); // keep the context recoverable
        this.contextLost = true;
    };
    private readonly onRestored = (): void => {
        this.contextLost = false;
        if (this.initGL()) this.onNeedsRedraw?.();
        else this.onContextFailed?.(); // couldn't rebuild the program → renderer swaps to canvas2d
    };

    /** Whether a usable WebGL2 context was acquired. */
    get ok(): boolean {
        return this.gl !== null;
    }

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        // alpha:true keeps the canvas transparent where nothing is drawn, so a layer behind it (the
        // reveal-layer background) shows through; the chart background is painted by the wrapper element.
        // antialias:FALSE — MSAA on a full-screen hi-DPI canvas (~7 MP at 2x) costs ~10 ms per
        // frame on the GPU, which pins a drag pan at ~70 fps on a 240 Hz display. Lines and
        // circles (dot markers, round joins/caps) are feathered analytically in the fragment
        // shader (see FRAG_SRC, Batch.circle), and the remaining solid geometry is axis-aligned
        // or sits under its own line, so nothing visible is lost.
        // premultipliedAlpha:TRUE is REQUIRED: the SRC_ALPHA over-blend writes PREMULTIPLIED
        // pixels (rgb·a) to the framebuffer, so the compositor must be told so — otherwise it
        // re-applies alpha and double-darkens every semi-transparent pixel (faint fills, and a
        // darkened line-AA feather that reads as jaggies). Matches canvas2d exactly.
        this.gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
        if (!this.gl) return;
        if (!this.initGL()) {
            this.gl = null; // shaders/program failed → ok=false → renderer uses canvas2d
            return;
        }
        // Attach loss/restore handling only once a usable program exists (so a
        // discarded backend never leaves listeners behind).
        canvas.addEventListener('webglcontextlost', this.onLost, false);
        canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    }

    /** (Re)compile the program + buffers. Returns false (and frees any partial GL
     *  objects) on failure, so both mount and a context-restore can react. */
    private initGL(): boolean {
        const gl = this.gl;
        if (!gl) return false;
        // Drop any stale glow handles (a context-loss invalidated them) so they're rebuilt.
        this.screenProgram = null;
        this.quadVao = null;
        this.quadVbo = null;
        this.fboA = this.fboB = null;
        this.texA = this.texB = null;
        this.fboW = this.fboH = 0;
        this.sliceTex.clear(); // context-lost handles are invalid; textures re-upload on demand
        this.sliceTexVersion.clear();
        const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
        const prog = gl.createProgram();
        if (!vs || !fs || !prog) {
            if (vs) gl.deleteShader(vs);
            if (fs) gl.deleteShader(fs);
            if (prog) gl.deleteProgram(prog);
            return false;
        }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            gl.deleteProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return false;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.program = prog;
        this.uRes = gl.getUniformLocation(prog, 'uRes');
        this.vbo = gl.createBuffer();
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        const stride = 8 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 2 * 4);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);
        gl.bindVertexArray(null);
        // Glow is optional — if its program/quad can't be built, disable it but keep
        // the base backend working.
        if (this.glow > 0 && !this.ensureScreenPipeline()) this.glow = 0;
        return true;
    }

    /** Compile the screen-quad program + fullscreen quad, shared by the glow post-process and
     *  the user-drawing interleave layers. Idempotent; FBOs (glow-only) are created lazily. */
    private ensureScreenPipeline(): boolean {
        if (this.screenProgram && this.quadVao) return true;
        const gl = this.gl;
        if (!gl) return false;
        const vs = compile(gl, gl.VERTEX_SHADER, SCREEN_VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, SCREEN_FRAG);
        const prog = gl.createProgram();
        if (!vs || !fs || !prog) {
            if (vs) gl.deleteShader(vs);
            if (fs) gl.deleteShader(fs);
            if (prog) gl.deleteProgram(prog);
            return false;
        }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            gl.deleteProgram(prog);
            return false;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.screenProgram = prog;
        this.uTex = gl.getUniformLocation(prog, 'uTex');
        this.uDir = gl.getUniformLocation(prog, 'uDir');
        this.uIntensity = gl.getUniformLocation(prog, 'uIntensity');
        this.quadVbo = gl.createBuffer();
        this.quadVao = gl.createVertexArray();
        gl.bindVertexArray(this.quadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        return true;
    }

    /** (Re)allocate the two half-res ping-pong FBOs to the given size. */
    private ensureFbos(gl: WebGL2RenderingContext, w: number, h: number): boolean {
        if (this.fboA && this.fboW === w && this.fboH === h) return true;
        this.deleteFbos(gl);
        const make = (): { tex: WebGLTexture | null; fbo: WebGLFramebuffer | null } => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            return { tex, fbo };
        };
        const a = make();
        const b = make();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.texA = a.tex;
        this.fboA = a.fbo;
        this.texB = b.tex;
        this.fboB = b.fbo;
        this.fboW = w;
        this.fboH = h;
        return !!(this.fboA && this.fboB);
    }

    private deleteFbos(gl: WebGL2RenderingContext): void {
        if (this.fboA) gl.deleteFramebuffer(this.fboA);
        if (this.fboB) gl.deleteFramebuffer(this.fboB);
        if (this.texA) gl.deleteTexture(this.texA);
        if (this.texB) gl.deleteTexture(this.texB);
        this.fboA = this.fboB = null;
        this.texA = this.texB = null;
        this.fboW = this.fboH = 0;
    }

    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        const gl = this.gl;
        const canvas = this.canvas;
        if (!gl || !canvas || !this.program || this.contextLost || gl.isContextLost()) return;
        const dpr = coords.dpr;
        const dataW = coords.width;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const n = coords.barCount;
        if (n === 0) return;
        const vr = coords.visibleLogicalRange();
        const i0 = Math.max(0, Math.floor(vr.from));
        const i1 = Math.min(n - 1, Math.ceil(vr.to));
        if (i1 < i0) return;
        // Indicator series and fills may carry points past the last bar (a plot shifted
        // forward), so they paint through the visible right whitespace too.
        const s1 = Math.max(i1, Math.ceil(vr.to));

        // Blend/scissor are enabled once; the program/VAO/uniform bindings live in each pane's
        // `flush`, since an interleave-layer quad swaps them mid-pane anyway.
        gl.enable(gl.BLEND);
        gl.enable(gl.SCISSOR_TEST);
        const barColorMap = mergeBarColors(scene.indicators);
        const panes = scene.orderedPanes();
        const liveSlices = /* @__PURE__ */ new Set();
        for (const pane of panes) {
            const b = this.batch;
            b.reset();
            const topDev = Math.round(pane.bounds.top * dpr);
            const botDev = Math.round((pane.bounds.top + pane.bounds.height) * dpr);
            const leftOff = coords.leftOffsetPx; // 0 unless the scale docks left
            gl.scissor(Math.round(leftOff * dpr), canvas.height - botDev, Math.round(dataW * dpr), botDev - topDev);
            const flush = () => {
                if (b.vertexCount === 0) return;
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.useProgram(this.program);
                gl.bindVertexArray(this.vao);
                gl.uniform2f(this.uRes, canvas.width / dpr, canvas.height / dpr);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
                gl.bufferData(gl.ARRAY_BUFFER, b.view, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, b.vertexCount);
                b.reset();
            };
            const slices = pane.collapsed ? [] : scene.drawingSlices.get(pane.id) ?? [];
            let si = 0;
            const drawSlicesUpTo = (z: number) => {
                for (; si < slices.length && slices[si]!.beforeZ <= z; si += 1) {
                    flush();
                    if (this.drawSliceTexture(gl, slices[si]!)) liveSlices.add(slices[si]!.canvas);
                }
            };
            b.alpha = 1;
            if (!pane.collapsed) {
                const models = scene.orderedIndicatorsForPane(pane.id);
                const isPrice = pane.kind === "price";
                const effPane = (m: any) => {
                    const sc = scene.scaleFor(m, pane);
                    return sc === pane.scale ? pane : { ...pane, scale: sc };
                };
                b.alpha = this.modelAlpha;
                for (const m of models) for (const bgSpan of m.backgrounds) if (bgSpan.overlay !== true) this.emitBackground(b, bgSpan, pane, coords);
                if (isPrice) {
                    for (const m of scene.indicators.values()) {
                        for (const bgSpan of m.backgrounds) if (bgSpan.overlay === true) this.emitBackground(b, bgSpan, pane, coords);
                    }
                }
                const drawCandles = isPrice && !scene.candlesHidden;
                let candleDrawn = false;
                for (const m of models) {
                    if (drawCandles && !candleDrawn && scene.zOf(m.id) >= scene.candleZ) {
                        drawSlicesUpTo(scene.candleZ);
                        b.alpha = this.candleStructureAlpha;
                        this.emitPriceSeries(b, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
                        candleDrawn = true;
                    }
                    drawSlicesUpTo(scene.zOf(m.id));
                    b.alpha = this.modelAlpha;
                    const off = scene.offsetOf(m.id);
                    const mp = effPane(m);
                    // Fills paint at the model's z slot, under its own series — a band between
                    // two plots sits behind the plot lines, and the whole model moves as one
                    // unit when its object-tree row is reordered.
                    for (const f of m.fills) if (f.overlay !== true) this.emitFill(b, m, f, mp, coords, i0, s1, off);
                    for (const s of m.series) if (s.overlay !== true) this.emitSeries(b, s, mp, coords, i0, s1, theme, off);
                }
                if (drawCandles && !candleDrawn) {
                    drawSlicesUpTo(scene.candleZ);
                    b.alpha = this.candleStructureAlpha;
                    this.emitPriceSeries(b, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
                }
                b.alpha = this.modelAlpha;
                if (isPrice) {
                    for (const m of scene.indicators.values()) {
                        const off = scene.offsetOf(m.id);
                        for (const f of m.fills) if (f.overlay === true) this.emitFill(b, m, f, pane, coords, i0, s1, off);
                    }
                    for (const m of scene.indicators.values()) {
                        const off = scene.offsetOf(m.id);
                        for (const s of m.series) if (s.overlay === true) this.emitSeries(b, s, pane, coords, i0, s1, theme, off);
                    }
                }
                drawSlicesUpTo(Infinity);
                for (const m of models) {
                    const mp = effPane(m);
                    for (const pl of m.priceLines) this.emitHline(b, pl, mp, coords, dataW, theme);
                }
                b.alpha = 1;
            }
            flush();
        }
        gl.disable(gl.SCISSOR_TEST);
        for (const [cv, tex] of this.sliceTex) {
            if (!liveSlices.has(cv)) {
                gl.deleteTexture(tex);
                this.sliceTex.delete(cv);
                this.sliceTexVersion.delete(cv);
            }
        }
        if (this.glow > 0 && !this.screenProgram && !this.ensureScreenPipeline()) this.glow = 0;
        if (this.glow > 0 && this.screenProgram) {
            this.glowBatch.alpha = this.modelAlpha; // the glow of faded series fades too
            this.renderGlow(gl, scene, coords, i0, s1);
        }
    }

    /**
     * Neon bloom: re-render the line series into a half-res FBO, blur it (separable
     * Gaussian, ping-pong), then additively composite the halo over the sharp scene.
     */
    private renderGlow(gl: WebGL2RenderingContext, scene: SceneGraph, coords: CoordinateSystem, i0: number, i1: number): void {
        const canvas = this.canvas;
        if (!canvas) return;
        const hw = Math.max(1, canvas.width >> 1);
        const hh = Math.max(1, canvas.height >> 1);
        if (!this.ensureFbos(gl, hw, hh)) return;
        const dpr = coords.dpr;
        const dataW = coords.width;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
        gl.viewport(0, 0, hw, hh);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.uniform2f(this.uRes, canvas.width / dpr, canvas.height / dpr);
        gl.enable(gl.SCISSOR_TEST);
        for (const pane of scene.orderedPanes()) {
            const b = this.glowBatch;
            b.reset();
            this.emitGlowSources(b, scene, pane, coords, i0, i1);
            if (b.vertexCount === 0) continue;
            const topH = Math.round(pane.bounds.top * dpr * 0.5);
            const botH = Math.round((pane.bounds.top + pane.bounds.height) * dpr * 0.5);
            const leftOff = coords.leftOffsetPx; // 0 unless the scale docks left
            gl.scissor(Math.round(leftOff * dpr * 0.5), hh - botH, Math.round(dataW * dpr * 0.5), botH - topH);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, b.view, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, b.vertexCount);
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.useProgram(this.screenProgram);
        gl.bindVertexArray(this.quadVao);
        gl.uniform1i(this.uTex, 0);
        gl.uniform1f(this.uIntensity, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
        gl.bindTexture(gl.TEXTURE_2D, this.texA);
        gl.uniform2f(this.uDir, 1 / hw, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
        gl.bindTexture(gl.TEXTURE_2D, this.texB);
        gl.uniform2f(this.uDir, 0, 1 / hh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindTexture(gl.TEXTURE_2D, this.texA);
        gl.uniform2f(this.uDir, 0, 0);
        gl.uniform1f(this.uIntensity, this.glow);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindVertexArray(null);
    }

    /** Composite one drawing interleave layer: upload its canvas (premultiplied, y-flipped —
     *  the framebuffer holds premultiplied pixels, see mount) unless the texture already holds
     *  the slice's version, and draw it as a fullscreen quad
     *  through the screen pipeline. The pane scissor is already set, so it clips to the pane.
     *  Returns false when the screen pipeline can't compile — the layer is skipped, not fatal. */
    private drawSliceTexture(gl: WebGL2RenderingContext, slice: DrawingSlice): boolean {
        if (!this.ensureScreenPipeline() || !this.screenProgram) return false;
        const { canvas, version } = slice;
        let tex = this.sliceTex.get(canvas) ?? null;
        if (!tex) {
            tex = gl.createTexture();
            if (!tex) return false;
            this.sliceTex.set(canvas, tex);
            this.sliceTexVersion.delete(canvas);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // a slice at the version this texture holds has the same pixels: no upload
        if (version === undefined || this.sliceTexVersion.get(canvas) !== version) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            if (version === undefined) this.sliceTexVersion.delete(canvas);
            else this.sliceTexVersion.set(canvas, version);
        }
        gl.useProgram(this.screenProgram);
        gl.bindVertexArray(this.quadVao);
        gl.uniform1i(this.uTex, 0);
        gl.uniform2f(this.uDir, 0, 0); // passthrough (no blur)
        gl.uniform1f(this.uIntensity, 1);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        return true;
    }

    /** The "neon" elements that glow: line/area/step lines + point markers (not candles/fills/bars).
     *  Routing mirrors the main pass: own series per pane, force_overlay series on the price pane. */
    private emitGlowSources(b: Batch, scene: SceneGraph, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number): void {
        const emitOne = (s: SeriesSpec, off: number): void => {
            if (!isLineLikeSeries(s) || !seriesShownOn(s, 'pane')) return;
            if (s.kind === 'histogram' || s.kind === 'columns') return;
            if (s.kind === 'circles' || s.kind === 'cross') this.emitPointMarkers(b, s, pane, coords, i0, i1, off);
            else this.emitPolylineRun(b, this.glowLineRuns, s, pane, coords, i0, i1, s.kind === 'step', off);
        };
        for (const m of scene.indicatorsForPane(pane.id)) {
            const off = scene.offsetOf(m.id);
            for (const s of m.series) if (s.overlay !== true) emitOne(s, off);
        }
        if (pane.kind === 'price') {
            for (const m of scene.indicators.values()) {
                const off = scene.offsetOf(m.id);
                for (const s of m.series) if (s.overlay === true) emitOne(s, off);
            }
        }
    }

    destroy(): void {
        const gl = this.gl;
        if (this.canvas) {
            this.canvas.removeEventListener('webglcontextlost', this.onLost);
            this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
        }
        if (gl) {
            if (this.program) gl.deleteProgram(this.program);
            if (this.vbo) gl.deleteBuffer(this.vbo);
            if (this.vao) gl.deleteVertexArray(this.vao);
            if (this.screenProgram) gl.deleteProgram(this.screenProgram);
            if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
            if (this.quadVao) gl.deleteVertexArray(this.quadVao);
            for (const tex of this.sliceTex.values()) gl.deleteTexture(tex);
            this.sliceTex.clear();
            this.sliceTexVersion.clear();
            this.deleteFbos(gl);
            // Release the CONTEXT itself, not just its resources: browsers cap live
            // WebGL contexts per page (~16) and reclaim destroyed ones LAZILY. Without
            // an explicit loseContext(), chart create/destroy cycles (SPA navigation,
            // workspace layout churn) evict the OLDEST context — which can be a
            // still-visible chart's. Our own listeners are already detached above.
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
        this.gl = null;
        this.canvas = null;
        this.program = null;
        this.vao = null;
        this.vbo = null;
        this.screenProgram = null;
    }

    // ── geometry emit (mirrors Canvas2dBackend, in CSS-px space) ──
    private emitBackground(b: Batch, bg: Background, pane: PaneNode, coords: CoordinateSystem): void {
        const x1 = coords.timeToX(bg.from);
        const x2 = coords.timeToX(bg.to);
        if (x2 < 0 || x1 > coords.width || x2 <= x1) return;
        b.rect(x1, pane.bounds.top, x2 - x1, pane.bounds.height, parseColor(bg.color));
    }

    private emitFill(b: Batch, model: IndicatorModel, fill: Fill, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const from = findPoints(model, fill.fromSeriesId);
        const to = findPoints(model, fill.toSeriesId);
        if (!from || !to) return;
        for (let i = Math.max(1, i0); i <= i1; i += 1) {
            const a0 = from[i - 1 - off];
            const b0 = to[i - 1 - off];
            const a1 = from[i - off];
            const b1 = to[i - off];
            if (!a0 || !b0 || !a1 || !b1 || a0.value === null || b0.value === null || a1.value === null || b1.value === null) continue;
            const xPrev = coords.logicalToX(i - 1);
            const xCur = coords.logicalToX(i);
            const tPrev = coords.priceToY(a0.value, pane.scale, pane.bounds);
            const bPrev = coords.priceToY(b0.value, pane.scale, pane.bounds);
            const tCur = coords.priceToY(a1.value, pane.scale, pane.bounds);
            const bCur = coords.priceToY(b1.value, pane.scale, pane.bounds);
            // Style by the LEFT/head column (matches FillPrimitive's run-head convention).
            const grad = fill.gradient?.[i - 1 - off];
            if (grad) {
                const yTop = coords.priceToY(grad.topValue, pane.scale, pane.bounds);
                const yBot0 = coords.priceToY(grad.bottomValue, pane.scale, pane.bounds);
                const yBot = yBot0 === yTop ? yTop + 1 : yBot0; // match canvas2d's degenerate nudge
                const tc = parseColor(grad.topColor);
                const bc = parseColor(grad.bottomColor);
                const span = yBot - yTop;
                const at = (y: number): RGBA => lerpColor(tc, bc, clamp01((y - yTop) / span));
                // quad corners: TL(xPrev,tPrev) TR(xCur,tCur) BR(xCur,bCur) BL(xPrev,bPrev)
                b.quad4(xPrev, tPrev, at(tPrev), xCur, tCur, at(tCur), xCur, bCur, at(bCur), xPrev, bPrev, at(bPrev));
            } else {
                const color = fill.colors ? fill.colors[i - 1 - off] : fill.color;
                if (!color) continue;
                b.quad(xPrev, tPrev, xCur, tCur, xCur, bCur, xPrev, bPrev, parseColor(color));
            }
        }
    }

    // ── base price series (chart type) — mirrors Canvas2dBackend.drawPriceSeries ──
    private emitPriceSeries(
        b: Batch,
        scene: SceneGraph,
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
        dataW: number,
    ): void {
        if (scene.basePainting === 'none') return; // plugin style fully replaces the price series
        const bars = scene.bars;
        const st = scene.style;
        switch (scene.priceStyle) {
            case 'bars':
                this.emitBars(b, bars, i0, i1, coords, pane, st.bars.upColor ?? theme.upColor, st.bars.downColor ?? theme.downColor, barColors);
                return;
            case 'line':
                this.emitPriceLine(b, bars, i0, i1, coords, pane, parseColor(st.line.color ?? theme.upColor), st.line.width);
                return;
            case 'area': {
                const lineColor = st.area.lineColor ?? theme.upColor;
                this.emitPriceArea(b, bars, i0, i1, coords, pane, parseColor(st.area.topColor ?? lineColor), parseColor(st.area.bottomColor ?? 'rgba(0,0,0,0)'));
                this.emitPriceLine(b, bars, i0, i1, coords, pane, parseColor(lineColor), st.area.width);
                return;
            }
            case 'baseline':
                this.emitBaseline(b, bars, i0, i1, coords, pane, scene, theme, dataW);
                return;
            default: // 'candles' + candle-drawn styles (a plugin style may fade candles to reveal its
                // order-flow layer) and 'heikinashi' (the bars themselves arrive already transformed)
                this.emitCandles(b, scene, bars, i0, i1, coords, pane, theme, barColors);
        }
    }

    /** OHLC bars: high-low stick + left open tick + right close tick (no body). */
    private emitBars(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, up: string, down: string, barColors: ReadonlyMap<number, string>): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        if (tier === 'aggregate') {
            this.emitCandlesAggregated(b, bars, i0, i1, coords, pane, (bar) => barColors.get(bar.time) ?? (bar.close >= bar.open ? up : down));
            return;
        }
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        const drawTicks = tier === 'full';
        for (let i = i0; i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar || bar.high <= bar.low) continue;
            const c = parseColor(barColors.get(bar.time) ?? (bar.close >= bar.open ? up : down));
            const x = Math.round(coords.logicalToX(i));
            const hY = coords.priceToY(bar.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(bar.low, pane.scale, pane.bounds);
            b.rect(x - 0.5, hY, 1, lY - hY, c);
            if (drawTicks) {
                const oY = coords.priceToY(bar.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(bar.close, pane.scale, pane.bounds);
                b.rect(x - tickW, oY - 0.5, tickW, 1, c);
                b.rect(x, cY - 0.5, tickW, 1, c);
            }
        }
    }

    /** Close-price line (also the top stroke of the area style). */
    private emitPriceLine(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, c: RGBA, width: number): void {
        const hw = Math.max(1, width) / 2;
        const segs = joinSegments(hw);
        let have = false;
        let px = 0;
        let py = 0;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar) {
                have = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(bar.close, pane.scale, pane.bounds);
            if (have) b.seg(px, py, x, y, width, c);
            b.circle(x, y, hw, c, segs); // round join at each vertex (round cap at run ends) — no faceted kinks
            px = x;
            py = y;
            have = true;
        }
    }

    /** Filled area under the close line: per-bar quads gradient `top` (at the line) →
     *  `bottom` (at the pane floor). Defaults fade the line color out (bottom transparent). */
    private emitPriceArea(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, top: RGBA, bottom: RGBA): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        const run: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        const flush = (): void => {
            if (run.length >= 2) {
                const span = baseY - minY;
                const at = (y: number): RGBA => lerpColor(top, bottom, span < 1e-6 ? 0 : clamp01((y - minY) / span));
                for (let k = 1; k < run.length; k += 1) {
                    const a = run[k - 1]!;
                    const c = run[k]!;
                    b.quad4(a.x, a.y, at(a.y), c.x, c.y, at(c.y), c.x, baseY, bottom, a.x, baseY, bottom);
                }
            }
            run.length = 0;
            minY = Infinity;
        };
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar) {
                flush();
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(bar.close, pane.scale, pane.bounds);
            run.push({ x, y });
            if (y < minY) minY = y;
        }
        flush();
    }

    /**
     * Baseline style: per-segment fill quads down to the baseline, up color above /
     * down color below. Each area is a two-stop gradient — the near-line fill far from
     * the baseline blending to the fainter near-baseline fill at it. A dashed baseline
     * marker + the per-segment line on top.
     */
    private emitBaseline(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, scene: SceneGraph, theme: VelaTheme, dataW: number): void {
        const baseline = scene.baselinePriceFor(pane.scale);
        const baseY = coords.priceToY(baseline, pane.scale, pane.bounds);
        const bs = scene.style.baseline;
        const topLineStr = bs.topLineColor ?? BASELINE_TOP_LINE;
        const bottomLineStr = bs.bottomLineColor ?? BASELINE_BOTTOM_LINE;
        const topLine = parseColor(topLineStr);
        const bottomLine = parseColor(bottomLineStr);
        const topFill = parseColor(bs.topFillColor ?? cssWithAlpha(topLineStr, BASELINE_FILL_ALPHA));
        const topFill2 = parseColor(bs.topFillColor2 ?? cssWithAlpha(topLineStr, BASELINE_FILL_ALPHA_FAR));
        const bottomFill = parseColor(bs.bottomFillColor ?? cssWithAlpha(bottomLineStr, BASELINE_FILL_ALPHA));
        const bottomFill2 = parseColor(bs.bottomFillColor2 ?? cssWithAlpha(bottomLineStr, BASELINE_FILL_ALPHA_FAR));
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar) continue;
            pts.push({ x: coords.logicalToX(i), y: coords.priceToY(bar.close, pane.scale, pane.bounds) });
        }
        if (pts.length < 2) return;
        const top = pane.bounds.top;
        const bottom = pane.bounds.top + pane.bounds.height;
        // The near-baseline fill for a vertex's side (used at the baseline edge of the quad).
        const farFill = (y: number): RGBA => (y <= baseY ? topFill2 : bottomFill2);
        // Fill at a line vertex: blend the near-baseline → near-line fill by how far the
        // close sits from the baseline (matches canvas2d's clipped two-stop gradient).
        const sideFill = (y: number): RGBA => {
            const above = y <= baseY;
            const region = above ? baseY - top : bottom - baseY;
            const t = region > 0 ? clamp01(Math.abs(y - baseY) / region) : 0;
            return lerpColor(above ? topFill2 : bottomFill2, above ? topFill : bottomFill, t);
        };
        for (let k = 1; k < pts.length; k += 1) {
            const a = pts[k - 1]!;
            const c = pts[k]!;
            // Split the fill AT the baseline crossing (mirrors the stroke split below): a
            // single quad down to the baseline would straddle both sides and bleed one
            // side's fill color onto the other. Each half is a triangle wholly on its side.
            if ((a.y <= baseY) !== (c.y <= baseY) && c.y !== a.y) {
                const t = (baseY - a.y) / (c.y - a.y);
                const xCross = a.x + (c.x - a.x) * t;
                b.tri(a.x, a.y, sideFill(a.y), xCross, baseY, farFill(a.y), a.x, baseY, farFill(a.y));
                b.tri(xCross, baseY, farFill(c.y), c.x, c.y, sideFill(c.y), c.x, baseY, farFill(c.y));
            } else {
                b.quad4(a.x, a.y, sideFill(a.y), c.x, c.y, sideFill(c.y), c.x, baseY, farFill(c.y), a.x, baseY, farFill(a.y));
            }
        }
        b.dashedSeg(0, baseY, dataW, baseY, 1, parseColor(scene.style.borderColor ?? theme.borderColor), DASH.dashed ?? null);
        for (let k = 1; k < pts.length; k += 1) {
            const a = pts[k - 1]!;
            const c = pts[k]!;
            const aUp = a.y <= baseY;
            const cUp = c.y <= baseY;
            // Split the segment AT the baseline so each side is colored correctly — a
            // segment must never be the up color below the baseline (or vice versa).
            if (aUp !== cUp && c.y !== a.y) {
                const t = (baseY - a.y) / (c.y - a.y);
                const xCross = a.x + (c.x - a.x) * t;
                b.seg(a.x, a.y, xCross, baseY, bs.width, aUp ? topLine : bottomLine);
                b.seg(xCross, baseY, c.x, c.y, bs.width, cUp ? topLine : bottomLine);
            } else {
                b.seg(a.x, a.y, c.x, c.y, bs.width, aUp ? topLine : bottomLine);
            }
        }
    }

    private emitCandles(b: Batch, scene: SceneGraph, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, theme: VelaTheme, barColors: ReadonlyMap<number, string>): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        const paint = effectiveCandlePaint(scene.style.candle, scene.candleOverride, theme.upColor, theme.downColor);
        const up = paint.up;
        const down = paint.down;
        const cs = paint.candle;
        if (tier === 'aggregate') {
            // The stick IS the candle, so a bar's paint resolves as in the stick-only tier
            // below: the wick color setting wins, then barcolor(), then the direction color.
            this.emitCandlesAggregated(b, bars, i0, i1, coords, pane, (bar) => {
                const isUp = bar.close >= bar.open;
                return (isUp ? cs.wickUpColor : cs.wickDownColor) ?? barColors.get(bar.time) ?? (isUp ? up : down);
            });
            return;
        }
        const drawBody = tier === 'full';
        // When a fading style drops the body below the structure, draw a body outline even
        // if no border is configured — so the candle keeps a visible (hollow) skeleton.
        const fading = this.candleStructureAlpha > this.candleBodyAlpha + 0.001;
        for (let i = i0; i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar || bar.high <= bar.low) continue;
            const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);
            const isUp = bar.close >= bar.open;
            const dir = isUp ? up : down;
            const bc = barColors.get(bar.time);
            const bodyColorStr = bc ?? dir;
            const c = parseColor(bodyColorStr);
            let bodyTop = 0;
            let bodyH = 0;
            if (drawBody) {
                const oY = coords.priceToY(bar.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(bar.close, pane.scale, pane.bounds);
                bodyTop = snapY(Math.min(oY, cY), coords.dpr);
                bodyH = Math.max(1 / coords.dpr, snapY(Math.max(oY, cY), coords.dpr) - bodyTop);
            }
            if (cs.wickVisible) {
                const hY = snapY(coords.priceToY(bar.high, pane.scale, pane.bounds), coords.dpr);
                const lY = snapY(coords.priceToY(bar.low, pane.scale, pane.bounds), coords.dpr);
                b.alpha = this.candleStructureAlpha;
                const wCol = parseColor((isUp ? cs.wickUpColor : cs.wickDownColor) ?? (drawBody ? dir : bodyColorStr));
                if (drawBody) {
                    b.rect(g.wickX, hY, g.wickW, Math.max(0, bodyTop - hY), wCol);
                    b.rect(g.wickX, bodyTop + bodyH, g.wickW, Math.max(0, lY - (bodyTop + bodyH)), wCol);
                } else {
                    b.rect(g.wickX, hY, g.wickW, lY - hY, wCol);
                }
            }
            if (drawBody) {
                const isHollow = scene.priceStyle === "hollow";
                const fillBody = isHollow ? !isUp : cs.bodyVisible;
                if (fillBody) {
                    b.alpha = this.candleBodyAlpha;
                    b.rect(g.bodyX, bodyTop, g.bodyW, bodyH, c);
                }
                if (cs.borderVisible || fading && cs.bodyVisible || isHollow) {
                    b.alpha = this.candleStructureAlpha;
                    const bord = (cs.borderVisible || isHollow) ? parseColor((isUp ? cs.borderUpColor : cs.borderDownColor) ?? bodyColorStr) : c;
                    const bw = Math.max(0, g.bodyW - 1);
                    const bh = Math.max(0, bodyH - 1);
                    b.rectStroke(g.bodyX + 0.5, bodyTop + 0.5, bw, bh, 1, bord);
                }
            }
        }
    }

    /**
     * Sub-pixel LOD (mirrors Canvas2dBackend.drawCandlesAggregated): bars sharing a
     * rounded pixel column collapse into high-low sticks — one per contiguous
     * SAME-COLOR coverage run (see {@link aggregateCandleColumns}), so a price gap
     * inside the column stays a void and every bar's extent keeps its own color. Draw
     * cost stays bounded by screen width, not bar count. `colorOf` is the calling
     * style's per-bar paint rule (candles and OHLC bars resolve theirs differently).
     */
    private emitCandlesAggregated(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, colorOf: (bar: OHLCV) => string): void {
        const yOf = (price: number): number => coords.priceToY(price, pane.scale, pane.bounds);
        for (const s of aggregateCandleColumns(bars, i0, i1, (i) => coords.logicalToX(i), yOf, colorOf)) {
            const c = parseColor(s.color);
            const hY = yOf(s.hi);
            b.rect(s.x - 0.5, hY, 1, yOf(s.lo) - hY, c);
        }
    }

    private emitSeries(b: Batch, spec: SeriesSpec, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        // Off-pane series (legend/data-window-only readouts, hidden fill anchors) are
        // kept in the model for fills and readouts but never painted here.
        if (!seriesShownOn(spec, 'pane')) return;
        if (spec.kind === 'candle' || spec.kind === 'bar') {
            this.emitPlotCandles(b, spec, pane, coords, i0, i1, theme, off);
            return;
        }
        if (!isLineLikeSeries(spec)) return;
        switch (spec.kind) {
            case 'histogram':
            case 'columns':
                this.emitHistogram(b, spec, pane, coords, i0, i1, off);
                break;
            case 'area':
                this.emitArea(b, spec, pane, coords, i0, i1, off);
                this.emitPolylineRun(b, this.lineRuns, spec, pane, coords, i0, i1, false, off);
                break;
            case 'circles':
            case 'cross':
                this.emitPointMarkers(b, spec, pane, coords, i0, i1, off);
                break;
            case 'step':
                this.emitPolylineRun(b, this.lineRuns, spec, pane, coords, i0, i1, true, off);
                break;
            default:
                this.emitPolylineRun(b, this.lineRuns, spec, pane, coords, i0, i1, false, off);
        }
    }

    /**
     * {@link emitPolyline}, replaying the line's kept vertices from `runs` while everything the
     * build reads is unchanged — the view, scale, bounds, style, step flag, batch alpha, and the
     * value and colour of every point it reads — so an unchanged line costs a comparison of its
     * visible points and one copy instead of a rebuild. The output is the same vertices either way.
     */
    private emitPolylineRun(b: Batch, runs: WeakMap<LineLikeSeries, LineRun>, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, step: boolean, off: number): void {
        const now = this.lineInputs;
        now.rightEdge = coords.rightEdgeLogical;
        now.anchorX = coords.logicalToX(now.rightEdge);
        now.pitch = coords.pxPerBar();
        now.first = Math.max(1, i0 - 1);
        now.last = i1;
        now.min = pane.scale.min;
        now.max = pane.scale.max;
        now.log = !!pane.scale.log;
        now.invert = !!pane.scale.invert;
        now.top = pane.bounds.top;
        now.height = pane.bounds.height;
        now.width = s.style.width;
        now.lineStyle = s.style.lineStyle;
        now.color = s.style.color;
        now.step = step;
        now.alpha = b.alpha;
        let run = runs.get(s);
        if (!run || !sameLineInputs(run.inputs, now)) {
            if (run) {
                Object.assign(run.inputs, now);
                run.pointsKept = false;
                run.vertices = null;
            } else {
                run = { inputs: { ...now }, pointsKept: false, values: [], colors: [], store: NO_FLOATS, vertices: null, oversized: false };
                runs.set(s, run);
            }
            // measured where the inputs move, so a line too long to keep is never checked or copied
            const mark = b.floatCount;
            this.emitPolyline(b, s, pane, coords, i0, i1, step, off);
            run.oversized = b.floatCount - mark > MAX_RUN_FLOATS;
            return;
        }
        if (run.oversized) {
            this.emitPolyline(b, s, pane, coords, i0, i1, step, off);
            return;
        }
        // the build reads points[i − 1 − off] … points[i − off] for i in [first, last]
        const from = now.first - 1 - off;
        if (run.pointsKept && samePoints(run, s.points, from)) {
            if (run.vertices) {
                b.append(run.vertices);
                return;
            }
            const mark = b.floatCount;
            this.emitPolyline(b, s, pane, coords, i0, i1, step, off);
            keepVertices(run, b, mark);
            return;
        }
        keepPoints(run, s.points, from, Math.max(0, i1 - off - from + 1));
        run.pointsKept = true;
        run.vertices = null;
        this.emitPolyline(b, s, pane, coords, i0, i1, step, off);
    }

    private emitPolyline(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, step: boolean, off = 0): void {
        const w = Math.max(1, s.style.width);
        const hw = w / 2;
        const pattern = DASH[s.style.lineStyle] ?? null;
        // Round joins/caps for solid straight lines only — the butt-capped segments otherwise leave a
        // hard notch/kink at every vertex (visible when zoomed in). Dashed + step keep their corners.
        const rounded = !pattern && !step;
        const segs = joinSegments(hw);
        let have = false;
        let inX = 0;
        let inY = 0;
        let inC: RGBA = parseColor(s.style.color);
        for (let i = Math.max(1, i0 - 1); i <= i1; i += 1) {
            const p = s.points[i - off];
            const pv = s.points[i - 1 - off];
            if (!p || p.value === null || !pv || pv.value === null) { have = false; continue; }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            const px = coords.logicalToX(i - 1);
            const py = coords.priceToY(pv.value, pane.scale, pane.bounds);
            const c = parseColor(p.color ?? s.style.color);
            if (step) {
                b.dashedSeg(px, py, x, py, w, c, pattern);
                b.dashedSeg(x, py, x, y, w, c, pattern);
            } else {
                b.dashedSeg(px, py, x, y, w, c, pattern);
            }
            if (rounded) {
                if (!have) b.circle(px, py, hw, parseColor(pv.color ?? s.style.color), segs); // cap at a run's start
                else b.roundJoin(px, py, inX, inY, x - px, y - py, hw, inC, segs); // the bend into this segment
                const next = s.points[i + 1 - off];
                if (i === i1 || !next || next.value === null) b.circle(x, y, hw, c, segs); // cap at a run's end
                inX = x - px;
                inY = y - py;
                inC = c;
            }
            have = true;
        }
    }

    private emitArea(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        const base = parseColor(s.style.color);
        // Per contiguous run: a baseline→line band with a top-color → transparent fade
        // (gradient via per-vertex alpha; matches the canvas2d minY→baseY gradient).
        let run: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        const flush = (): void => {
            if (run.length < 1) {
                run = [];
                minY = Infinity;
                return;
            }
            const span = baseY - minY;
            const at = (y: number): RGBA => fadeAlpha(base, span < 1e-6 ? 0 : clamp01((y - minY) / span));
            for (let k = 1; k < run.length; k += 1) {
                const a = run[k - 1]!;
                const c = run[k]!;
                // quad: line-top (a, c) down to baseline — top verts faded by y, base verts transparent.
                b.quad4(a.x, a.y, at(a.y), c.x, c.y, at(c.y), c.x, baseY, ZERO, a.x, baseY, ZERO);
            }
            run = [];
            minY = Infinity;
        };
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) {
                flush();
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            run.push({ x, y });
            if (y < minY) minY = y;
        }
        flush();
    }

    private emitHistogram(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const spacing = coords.bodySpacing();
        const w = Math.max(1, (s.kind === 'columns' ? 0.7 : 0.8) * spacing);
        const half = w / 2;
        const base = s.style.base ?? 0;
        const baseY = coords.priceToY(base, pane.scale, pane.bounds);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            b.rect(x - half, Math.min(baseY, y), w, Math.max(1, Math.abs(y - baseY)), parseColor(p.color ?? s.style.color));
        }
    }

    private emitPointMarkers(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const r = Math.max(1.5, s.style.width);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            const c = parseColor(p.color ?? s.style.color);
            if (s.kind === 'cross') {
                b.seg(x - r, y, x + r, y, 1, c);
                b.seg(x, y - r, x, y + r, 1, c);
            } else {
                b.circle(x, y, r, c, Math.max(16, Math.ceil(r * 2))); // smoother at larger radii
            }
        }
    }

    private emitPlotCandles(b: Batch, s: CandleSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        const spacing = coords.bodySpacing();
        const up = s.style?.up ?? theme.upColor;
        const down = s.style?.down ?? theme.downColor;
        const isBar = s.kind === 'bar';
        const half = Math.max(0.5, Math.floor(spacing * 0.7) / 2);
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        for (let i = i0; i <= i1; i += 1) {
            const bar = s.bars[i - off];
            if (!bar || !Number.isFinite(bar.open + bar.high + bar.low + bar.close)) continue;
            const bc: CandleBarColor | null | undefined = s.barColors?.[i - off];
            const body = parseColor(bc?.color ?? (bar.close >= bar.open ? up : down));
            const x = Math.round(coords.logicalToX(i));
            const hY = coords.priceToY(bar.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(bar.low, pane.scale, pane.bounds);
            const oY = coords.priceToY(bar.open, pane.scale, pane.bounds);
            const cY = coords.priceToY(bar.close, pane.scale, pane.bounds);
            if (isBar) {
                b.rect(x - 0.5, hY, 1, lY - hY, body);
                b.rect(x - tickW, oY - 0.5, tickW, 1, body);
                b.rect(x, cY - 0.5, tickW, 1, body);
                continue;
            }
            const wDev = Math.max(1, Math.round(wickWidth(spacing) * coords.dpr));
            const wx = (Math.round(x * coords.dpr) - (wDev >> 1)) / coords.dpr;
            b.rect(wx, hY, wDev / coords.dpr, lY - hY, parseColor(bc?.wickColor ?? bc?.color ?? (bar.close >= bar.open ? up : down)));
            const top = Math.min(oY, cY);
            const h = Math.max(1, Math.abs(cY - oY));
            b.rect(x - half, top, half * 2, h, body);
            if (bc?.borderColor) {
                const bord = parseColor(bc.borderColor);
                b.rect(x - half, top, half * 2, 1, bord);
                b.rect(x - half, top + h - 1, half * 2, 1, bord);
                b.rect(x - half, top, 1, h, bord);
                b.rect(x + half - 1, top, 1, h, bord);
            }
        }
    }

    private emitHline(b: Batch, pl: PriceLine, pane: PaneNode, coords: CoordinateSystem, dataW: number, theme: VelaTheme): void {
        const y = Math.round(coords.priceToY(pl.price, pane.scale, pane.bounds));
        if (y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) return;
        const leftOff = coords.leftOffsetPx; // 0 unless the scale docks left
        const minX = leftOff;
        const maxX = leftOff + dataW;
        b.dashedSeg(minX, y, maxX, y, pl.width ?? 1, parseColor(pl.color ?? theme.textColor), DASH[pl.lineStyle ?? "solid"] ?? null);
    }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
    }
    return sh;
}

const ZERO: RGBA = [0, 0, 0, 0];

function clamp01(t: number): number {
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

function fadeAlpha(c: RGBA, t: number): RGBA {
    // Fade toward transparent BLACK (rgb + alpha → 0) to match canvas2d's
    // createLinearGradient(color → 'rgba(0,0,0,0)') area fill.
    const k = 1 - t;
    return [c[0] * k, c[1] * k, c[2] * k, c[3] * k];
}

function findPoints(model: IndicatorModel, seriesId: string): LineLikeSeries['points'] | null {
    const s = model.series.find((x) => x.id === seriesId);
    return s && isLineLikeSeries(s) ? s.points : null;
}

const EMPTY_BARCOLORS: ReadonlyMap<number, string> = new Map();

function mergeBarColors(indicators: Map<string, IndicatorModel>): ReadonlyMap<number, string> {
    let any = false;
    for (const m of indicators.values()) {
        if (m.barColors && m.barColors.length > 0) {
            any = true;
            break;
        }
    }
    if (!any) return EMPTY_BARCOLORS;
    const map = new Map<number, string>();
    for (const m of indicators.values()) {
        if (m.barColors) for (const bc of m.barColors) map.set(bc.time, bc.color);
    }
    return map;
}
