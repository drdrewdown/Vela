// What is under a plot point — the pane and its value there, the bar, a price-scale chip, a
// drawing label's tooltip. Pure over what the renderer already holds, so a host's hover card
// asks the renderer ONE question instead of reading the scene graph, the coordinate system
// and the chrome's chip boxes.
import type { PointerReadout, PointerReadoutPane, ScaleChip } from '../../../core/ports/IChartRenderer';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { PaneBounds, PriceScale } from './CoordinateSystem';

/** Pixels around a chip box that still count as a hit — chips are small targets. */
export const CHIP_HIT_PAD = 3;

export interface ReadoutPane {
    id: string;
    kind: 'price' | 'study';
    bounds: PaneBounds;
    scale: PriceScale;
}

export interface ReadoutSource {
    panes: Iterable<ReadoutPane>;
    /** Indicator models with the pane each renders on. */
    indicators: Iterable<{ id: string; paneId?: string }>;
    bars: readonly OHLCV[];
    chips: readonly ScaleChip[];
    coords: {
        xToLogical(x: number): number;
        yToPrice(y: number, scale: PriceScale, bounds: PaneBounds): number;
    };
    labelTooltipAt(x: number, y: number): string | null;
}

const inBox = (b: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean =>
    x >= b.x - CHIP_HIT_PAD && x <= b.x + b.w + CHIP_HIT_PAD && y >= b.y - CHIP_HIT_PAD && y <= b.y + b.h + CHIP_HIT_PAD;

/** The price-scale chip under a point (its price box or its tag box), or null. */
export function chipAt(chips: readonly ScaleChip[], x: number, y: number): ScaleChip | null {
    for (const c of chips) if (inBox(c.boxPrice, x, y) || inBox(c.boxTag, x, y)) return c;
    return null;
}

export function paneAt(panes: Iterable<ReadoutPane>, y: number): ReadoutPane | null {
    for (const p of panes) if (y >= p.bounds.top && y <= p.bounds.top + p.bounds.height) return p;
    return null;
}

export function pointerReadout(src: ReadoutSource, x: number, y: number): PointerReadout {
    const paneNode = paneAt(src.panes, y);
    let pane: PointerReadoutPane | null = null;
    if (paneNode) {
        const indicatorIds: string[] = [];
        for (const m of src.indicators) if (m.paneId === paneNode.id) indicatorIds.push(m.id);
        pane = { id: paneNode.id, kind: paneNode.kind, value: src.coords.yToPrice(y, paneNode.scale, paneNode.bounds), indicatorIds };
    }
    const logical = Math.round(src.coords.xToLogical(x));
    const b = logical >= 0 && logical < src.bars.length ? src.bars[logical] : undefined;
    const bar = b ? { index: logical, time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 } : null;
    return { x, y, pane, bar, chip: chipAt(src.chips, x, y), labelTooltip: src.labelTooltipAt(x, y) };
}
