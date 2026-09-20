// chart.bars() / chart.setBars() — the loaded series, readable and replaceable in place.
// A host's bar replay truncates the tape bar by bar: the renderer repaints with the framing
// kept, every native indicator re-reads the bars, and the raw series stays the source of truth.
import { describe, it, expect, afterEach } from 'vitest';
import { Vela } from '../src/index';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { VelaTheme } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';
import { registerNativeIndicator, unregisterNativeIndicator, type NativeIndicatorDescriptor, type NativeIndicatorContext } from '../src/core/native-indicators/NativeIndicator';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function makeBars(n: number): OHLCV[] {
    const bars: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) {
        bars.push({ time: 1_700_000_000_000 + i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 });
    }
    return bars;
}

class StaticFeed implements MarketDataFeed {
    constructor(private readonly series: OHLCV[]) {}
    async load(_cfg: MarketConfig): Promise<OHLCV[]> {
        return this.series;
    }
    subscribe(_cfg: MarketConfig, _onBar: (bar: OHLCV) => void): Unsubscribe {
        return () => {};
    }
}

class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    bars: OHLCV[] = [];
    setBarsCalls: { n: number; preserveView: boolean }[] = [];
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void {
        this.bars = bars;
        this.setBarsCalls.push({ n: bars.length, preserveView: !!opts?.preserveView });
    }
    setLoading(): void {}
    updateBar(bar: OHLCV): void { this.bars.push(bar); }
    setNativeData(): void {}
    ensurePane(_p: Pane): void {}
    removePane(_id: string): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(_h: IndicatorRenderHandle): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(_h: IndicatorRenderHandle, _v: boolean): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(_r: VisibleRange): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
}

/** A native that counts how many bars it sees on every notification. */
function probeNative(): { descriptor: NativeIndicatorDescriptor; seen: number[] } {
    const seen: number[] = [];
    let ctx: NativeIndicatorContext | null = null;
    const descriptor: NativeIndicatorDescriptor = {
        type: 'bars-probe',
        title: 'Bars probe',
        paneHint: 'price',
        overlay: true,
        inputsSchema: () => [],
        defaultInputs: () => ({}),
        create: () => ({
            start(c: NativeIndicatorContext) { ctx = c; seen.push(c.bars().length); c.emit({}); },
            onBars() { seen.push(ctx?.bars().length ?? -1); },
            onViewport() {},
            setInputs() {},
            suspend() {},
            resume() {},
            stop() {},
        }),
    };
    return { descriptor, seen };
}

const EL = {} as unknown as HTMLElement;
const charts: Vela[] = [];

afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
    unregisterNativeIndicator('bars-probe');
});

describe('chart.bars() / chart.setBars()', () => {
    it('bars() is the series the feed served, in full', async () => {
        const series = makeBars(40);
        const renderer = new FakeRenderer();
        const chart = new Vela(EL, { symbol: 'X', timeframe: '1', volume: false }, { renderer, engines: [], dataFeed: new StaticFeed(series) });
        charts.push(chart);
        await chart.ready();
        expect(chart.bars()).toHaveLength(40);
        expect(chart.bars()[39]).toEqual(series[39]);
    });

    it('setBars() replaces the series: the renderer repaints with the framing kept, natives re-read the bars', async () => {
        const { descriptor, seen } = probeNative();
        registerNativeIndicator(descriptor);
        const series = makeBars(40);
        const renderer = new FakeRenderer();
        const chart = new Vela(EL, { symbol: 'X', timeframe: '1', volume: false }, { renderer, engines: [], dataFeed: new StaticFeed(series) });
        charts.push(chart);
        chart.addNativeIndicator('bars-probe');
        await chart.ready();
        await flush();
        expect(seen[seen.length - 1]).toBe(40);
        const paints = renderer.setBarsCalls.length;

        chart.setBars(series.slice(0, 12), { preserveView: true });
        await flush();

        expect(chart.bars()).toHaveLength(12);
        expect(renderer.bars).toHaveLength(12);
        expect(renderer.setBarsCalls[paints]).toEqual({ n: 12, preserveView: true });
        expect(seen[seen.length - 1]).toBe(12);

        // stepping forward re-grows the tape; the full series restores it
        chart.setBars(series.slice(0, 13), { preserveView: true });
        await flush();
        expect(chart.bars()).toHaveLength(13);
        expect(seen[seen.length - 1]).toBe(13);
        chart.setBars(series, { preserveView: true });
        await flush();
        expect(chart.bars()).toHaveLength(40);
        expect(renderer.bars).toHaveLength(40);
    });

    it('returns the chart for chaining', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela(EL, { symbol: 'X', timeframe: '1', volume: false }, { renderer, engines: [], dataFeed: new StaticFeed(makeBars(5)) });
        charts.push(chart);
        await chart.ready();
        expect(chart.setBars(makeBars(3))).toBe(chart);
        expect(chart.bars()).toHaveLength(3);
    });
});
