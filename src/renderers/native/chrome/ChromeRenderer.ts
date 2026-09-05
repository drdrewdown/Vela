import type { VelaTheme } from '../../../core/options';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { LineStyle } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { percentScaleFor } from '../core/SceneGraph';
// Re-exported so existing importers (crosshair) can keep sourcing it from here.
export { percentScaleFor } from '../core/SceneGraph';
import { DrawingSceneRenderer, modelDrawingSet, type DrawingSet, type TimeWindow } from '../../shared/DrawingSceneRenderer';
import { renderTradeMarkers } from '../../shared/trade-markers';
import type { TradeExecution } from '../../../core/model/trades';
import { paneAxisTicks, formatAxisValue, timeTicks } from './ticks';
import { axisColumnX, PANE_SEPARATOR_PX } from './axisLayout';
import { parseColor } from '../backend/gl/color';
import { DARK_THEME } from '../../../core/theme';
import { tzOffsetMs } from './tz';

/**
 * Renderer-owned chrome layer (canvas2d) on its own canvas, stacked above the
 * geometry layer (L0) and below the cursor layer (L2). It draws the per-pane price
 * axes + labels, the time axis + labels, the current-price line + chip, and the
 * strategy trade markers. Pine drawings do NOT paint here: they prepaint into
 * interleave slices (IndicatorDrawingSlices) the geometry backend composites at
 * their model's z slot — this layer only keeps the shared DrawingSceneRenderer to
 * compute the drawing price-range that folds into autoscale (`paneDrawingsRange`).
 */
export class ChromeRenderer {
    /** Aether: hit regions of the price-scale chips drawn on the last frame (price box + on-canvas
     *  tag per chip), in canvas CSS pixels. Read by the host's hover HUD for THIS chart. */
    aetherChipBounds: any[] = [];
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    // The color for axis tick labels — the host-passed surface text, set each frame in render().
    private axisTextColor = DARK_THEME.textColor;
    // Shared Pine-drawing renderer, used here for autoscale geometry only; widthCache persists.
    private readonly drawScene = new DrawingSceneRenderer({ timeToLogical: () => 0, barAt: () => null, theme: {} as VelaTheme });

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    /** Wire the drawing coordinate resolvers + theme (call once per frame before use). */
    prepare(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        this.drawScene.setDeps({
            timeToLogical: (ms) => coords.timeToLogical(ms),
            barAt: (logical) => {
                const b = scene.bars[Math.round(logical)];
                return b ? { high: b.high, low: b.low } : null;
            },
            theme,
        });
    }

    /**
     * Visible Pine-drawing price range for a pane (folds into autoscale): the pane's
     * own (non-overlay) drawings, plus force_overlay drawings when it's the price pane.
     * Requires `prepare()` to have wired the resolvers for this frame.
     */
    paneDrawingsRange(ownModels: IndicatorModel[], scene: SceneGraph, isPricePane: boolean, vr: { from: number; to: number }, win?: TimeWindow): { min: number; max: number } | null {
        let dr: { min: number; max: number } | null = null;
        for (const m of ownModels) dr = unionRange(dr, this.drawingsRange(modelDrawingSet(m, false, win), vr, scene.offsetOf(m.id)));
        if (isPricePane) for (const m of scene.indicators.values()) dr = unionRange(dr, this.drawingsRange(modelDrawingSet(m, true, win), vr, scene.offsetOf(m.id)));
        return dr;
    }

    /** Clear the chrome canvas and draw drawings + axes + current-price line.
     *  `surface` (background + text) paints the axis-scale gutters — the host passes the live
     *  chart background so the scales read as part of the plot, with contrast-corrected text.
     *  Falls back to the theme's own colors when no surface is supplied. */
    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, surface?: { background: string; textColor: string }): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        const fullW = canvas.width / dpr;
        const fullH = canvas.height / dpr;
        const dataW = coords.width;
        const dataH = coords.height;
        // The gutters (and their labels) use the surface the host passes (the live chart
        // background); everything data-side keeps the live theme.
        this.axisTextColor = surface?.textColor ?? theme.textColor;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, fullW, fullH);
        // Paint the price-axis (right) + time-axis (bottom) gutters opaquely so drawings or
        // series pixels beneath never bleed into the scales. Data/drawings stay clear of
        // these strips, so this only ever covers the axis areas.
        const isLeft = typeof window !== "undefined" && window.__VELA_SCALE_SIDE__ === "left";
        const axisW = fullW - dataW;
        if (surface && (fullW > dataW || fullH > dataH)) {
            ctx.fillStyle = surface.background;
            if (axisW > 0) ctx.fillRect(isLeft ? 0 : dataW, 0, axisW, fullH);
            if (fullH > dataH) ctx.fillRect(isLeft ? axisW : 0, dataH, dataW, fullH - dataH);
        }
        ctx.font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';

        const panes = scene.orderedPanes();
        if (coords.barCount === 0) {
            // A market switch (timeframe/symbol) clears the series while the new bars
            // load, and any chrome frame in that window (crosshair move, resize) lands
            // here. The pane SEPARATORS are structural — they depend on pane bounds
            // alone, not bars — so they must survive the empty frame, or the stacked
            // panes read as one undivided plot until the load completes.
            this.drawPaneSeparators(ctx, scene, theme, fullW, panes);
            return;
        }
        const pricePane = panes.find((p) => p.kind === 'price') ?? null;

        // Pine drawings paint through the interleave slices at their model's z slot
        // (IndicatorDrawingSlices), NOT here — the chrome stays axes + markers + chips.

        // ── Strategy trade markers — always the PRICE pane, whatever pane the strategy's
        //    plots landed on (a fill price only means something on the price scale), above
        //    the drawings. Hiding the indicator removes its model, and the markers with it. ──
        if (pricePane && !pricePane.collapsed && scene.tradeMarkers.visible) {
            for (const m of scene.indicators.values()) {
                if (m.trades?.length) this.renderTrades(ctx, coords, scene, theme, m.trades, pricePane, dataW);
            }
        }

        // ── axes + current-price line + countdown ──
        this.drawPriceAxes(ctx, scene, coords, theme, dataW, panes);
        this.drawMergedScaleColumns(ctx, scene, coords, dataW);
        this.drawPaneSeparators(ctx, scene, theme, fullW, panes);
        this.drawVisibleRangeHighLow(ctx, scene, coords, theme, dataW, pricePane);
        this.drawPriceLineAndCountdown(ctx, scene, coords, theme, dataW, pricePane);
        this.drawTimeAxis(ctx, scene, coords, theme, dataW, dataH, fullH);
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    private drawingsRange(set: DrawingSet, vr: { from: number; to: number }, indexOffset = 0): { min: number; max: number } | null {
        this.drawScene.setSet(set, indexOffset);
        if (this.drawScene.isEmpty()) return null;
        const r = this.drawScene.priceRange(vr.from, vr.to);
        return r ? { min: r.min, max: r.max } : null;
    }

    private renderTrades(
        ctx: CanvasRenderingContext2D,
        coords: CoordinateSystem,
        scene: SceneGraph,
        theme: VelaTheme,
        trades: readonly TradeExecution[],
        pane: PaneNode,
        dataW: number,
    ): void {
        const isLeft = typeof window !== "undefined" && window.__VELA_SCALE_SIDE__ === "left";
        const fullW = ctx.canvas.width / coords.dpr;
        const axisW = fullW - dataW;
        const clipX = isLeft ? axisW : 0;
        ctx.save();
        ctx.translate(0, pane.bounds.top);
        ctx.beginPath();
        ctx.rect(clipX, 0, dataW, pane.bounds.height);
        ctx.clip();
        renderTradeMarkers(
            ctx,
            trades,
            scene.tradeMarkers,
            {
                timeToLogical: (ms) => coords.timeToLogical(ms),
                barAt: (logical) => {
                    const b = scene.bars[Math.round(logical)];
                    return b ? { high: b.high, low: b.low } : null;
                }
            },
            (logical) => coords.logicalToX(logical),
            (price) => coords.priceToY(price, pane.scale, pane.bounds) - pane.bounds.top,
            { fontSize: scene.style.fontSize, fontFamily: theme.fontFamily, color: theme.textColor },
            dataW,
            // Half the candle BODY width (bodies take ~0.8 of the pitch), so the
            // fill-price ticks hug the bar's edges at every zoom.
            Math.max(1.5, coords.bodySpacing() * 0.4)
        );
        ctx.restore();
    }

    // ── axes ──
    private drawPriceAxes(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, panes: PaneNode[]): void {
        const isLeft = typeof window !== "undefined" && window.__VELA_SCALE_SIDE__ === "left";
        const fullW = ctx.canvas.width / coords.dpr;
        const axisW = fullW - dataW;
        ctx.strokeStyle = scene.style.borderColor ?? theme.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const lineX = isLeft ? axisW - 0.5 : dataW + 0.5;
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, coords.height);
        ctx.stroke();
        if (!scene.showAxisLabels) return;
        ctx.fillStyle = this.axisTextColor;
        ctx.textAlign = isLeft ? "right" : "left";
        const textX = isLeft ? axisW - 6 : dataW + 6;
        for (const pane of panes) {
            if (pane.collapsed) continue;
            const pct = percentScaleFor(scene, pane);
            for (const t of paneAxisTicks(pane.scale, pane.bounds.height, pct, scene.priceMintick, pane.axisFormat)) {
                const y = coords.priceToY(t.price, pane.scale, pane.bounds);
                if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                ctx.fillText(t.label, textX, y);
            }
            if (pane.axisBands) {
                for (const b of pane.axisBands) {
                    const y = pane.bounds.top + b.frac * pane.bounds.height;
                    if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                    ctx.fillText(b.label, textX, y);
                }
            }
        }
        ctx.textAlign = "start";
    }

    /**
     * The horizontal divider at each stacked pane's top edge, spanning the FULL width (data area
     * + right-hand scale gutter) as one continuous line. Drawn on the chrome layer, above the data
     * canvas, so series/candles never overpaint it — the line reads at a uniform thickness across
     * the whole width. Its draggable hit-zone (input) and hover highlight (crosshair layer) match
     * this same full span.
     */
    private drawPaneSeparators(ctx: CanvasRenderingContext2D, scene: SceneGraph, theme: VelaTheme, fullW: number, panes: PaneNode[]): void {
        ctx.fillStyle = scene.style.separatorColor ?? theme.borderColor;
        for (const pane of panes) {
            if (pane.order <= 0) continue; // no separator above the topmost (price) pane
            ctx.fillRect(0, Math.round(pane.bounds.top) - 1, fullW, PANE_SEPARATOR_PX);
        }
    }

    /**
     * Draw an axis column per merged (own-scale) indicator, to the right of each pane's
     * master scale — tick labels in the chart's axis text color. Columns are told apart by
     * spacing alone (no divider line), and a collapsed pane's columns are skipped entirely.
     * This is what makes a merged indicator readable on its own values while sharing the pane.
     */
    private drawMergedScaleColumns(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, dataW: number): void {
        if (!scene.showAxisLabels) return;
        ctx.textAlign = 'left';
        // A merged column reads with the same axis text color as the master scale (from the
        // chart's settings) — no per-indicator tint, so the gutter stays uniform.
        ctx.fillStyle = this.axisTextColor;
        for (const pane of scene.orderedPanes()) {
            if (pane.collapsed) continue; // collapsed strip: legend only, no scale numbers
            const merged = scene.ownScaleIndicatorsForPane(pane.id);
            merged.forEach((model, k) => {
                const sc = scene.indicatorScales.get(model.id)?.scale;
                if (!sc) return;
                const x = axisColumnX(dataW, k + 1); // column 0 is the master scale
                for (const t of paneAxisTicks(sc, pane.bounds.height, undefined, scene.priceMintick)) {
                    const y = coords.priceToY(t.price, sc, pane.bounds);
                    if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                    ctx.fillText(t.label, x + 5, y);
                }
            });
        }
        ctx.textAlign = 'start';
    }

    /**
     * The latest-price chrome on the price pane, all colored with the price element's own
     * color (candle/bar up-down, line, area, or baseline side) and white text:
     *  - the dashed current-price LINE (`showPriceLine`) — fully independent of the label,
     *  - the last-price LABEL chip (`showPriceLabel`),
     *  - the countdown-to-bar-close chip (`showCountdown`).
     * When the label and countdown are both on they merge into one stacked block (countdown
     * under the label, text flushed left); a lone label or countdown is centered on the
     * price level with centered text. The countdown ticks once per second (repaint scheduled).
     */
    private drawPriceLineAndCountdown(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, pricePane: PaneNode | null): void {
        const n = scene.bars.length;
        if (!pricePane || n === 0 || scene.candlesHidden || pricePane.collapsed || pricePane.bounds.height <= 0) return;
        const last = scene.bars[n - 1]!;
        const y = coords.priceToY(last.close, pricePane.scale, pricePane.bounds);
        if (y < pricePane.bounds.top || y > pricePane.bounds.top + pricePane.bounds.height) return;

        const isLeft = typeof window !== "undefined" && window.__VELA_SCALE_SIDE__ === "left";
        const fullW = ctx.canvas.width / coords.dpr;
        const axisW = fullW - dataW;
        const chipBounds = [];

        // Helper to render a split chip and record its bounds
        const drawChip = (sPriceText: string, tag: string, sColor: string, sY: number, tooltipText?: string, titleText?: string, meta?: any) => {
            const sTextColor = tagTextColor(sColor, theme.background);
            const wPrice = Math.max(ctx.measureText(sPriceText).width + 8, 56);
            const wTag = Math.max(ctx.measureText(tag).width + 8, 38);
            const chipH = 16;
            const top = Math.round(sY - chipH / 2);

            let xPrice, xTag;
            if (isLeft) {
                xPrice = axisW - 1 - wPrice;
                ctx.fillStyle = sColor;
                ctx.fillRect(xPrice, top, wPrice, chipH);
                ctx.fillStyle = sTextColor;
                ctx.textAlign = "center";
                ctx.fillText(sPriceText, xPrice + wPrice / 2, top + chipH / 2);

                xTag = axisW + 1;
                ctx.fillStyle = sColor;
                ctx.fillRect(xTag, top, wTag, chipH);
                ctx.fillStyle = sTextColor;
                ctx.textAlign = "center";
                ctx.fillText(tag, xTag + wTag / 2, top + chipH / 2);
            } else {
                xTag = dataW - 1 - wTag;
                ctx.fillStyle = sColor;
                ctx.fillRect(xTag, top, wTag, chipH);
                ctx.fillStyle = sTextColor;
                ctx.textAlign = "center";
                ctx.fillText(tag, xTag + wTag / 2, top + chipH / 2);

                xPrice = dataW + 1;
                ctx.fillStyle = sColor;
                ctx.fillRect(xPrice, top, wPrice, chipH);
                ctx.fillStyle = sTextColor;
                ctx.textAlign = "center";
                ctx.fillText(sPriceText, xPrice + wPrice / 2, top + chipH / 2);
            }

            chipBounds.push({
                tag,
                title: titleText || tag,
                priceText: sPriceText,
                tooltip: tooltipText || (tag + ": " + sPriceText),
                color: sColor,
                boxPrice: { x: xPrice, y: top, w: wPrice, h: chipH },
                boxTag: { x: xTag, y: top, w: wTag, h: chipH },
                meta: meta || null,
            });
        };

        // 1. Indicator series chips (e.g. EMA9, EMA50, EMA100, EMA200, Key Levels, Volume Profile)
        const showIndicatorChips = typeof window === "undefined" || window.__VELA_INDICATOR_CHIPS__ !== false;
        if (showIndicatorChips) {
            ctx.font = `600 ${Math.max(9, (scene.style?.fontSize ?? 11) - 1)}px ${theme.fontFamily}`;
            ctx.textBaseline = "middle";

            // Chip candidates are plain records built from the live model; typed loosely on purpose —
            // this pass reads series points/styles that the SeriesSpec union does not expose.
            const candidateChips: any[] = [];

            if (scene.indicators) {
                for (const m of scene.indicators.values() as Iterable<any>) {
                    if (!m.series || (m.paneId && m.paneId !== pricePane.id)) continue;
                    for (const s of m.series) {
                        if (s.visible === false || !s.points || s.points.length === 0) continue;
                        let lastVal = null;
                        let ptColor = null;
                        for (let pIdx = s.points.length - 1; pIdx >= 0; pIdx--) {
                            const pt = s.points[pIdx];
                            if (pt && Number.isFinite(pt.value)) {
                                lastVal = pt.value;
                                ptColor = pt.color;
                                break;
                            }
                        }
                        if (lastVal == null) continue;
                        const sY = coords.priceToY(lastVal, pricePane.scale, pricePane.bounds);
                        if (sY < pricePane.bounds.top || sY > pricePane.bounds.top + pricePane.bounds.height) continue;

                        const sColor = ptColor || s.style?.color || "#5aa1ff"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
                        const rawTag = (s.title || s.id || "").replace(/\s+/g, "");
                        const tag = rawTag.length > 8 ? rawTag.slice(0, 8) : rawTag;
                        if (!tag) continue;
                        const sPriceText = formatAxisValue(pricePane.scale, pricePane.bounds.height, lastVal, percentScaleFor(scene, pricePane), scene.priceMintick);

                        let tip = tag + ": " + sPriceText;
                        if (tag === "EMA9") tip = "EMA (9): " + sPriceText + "\nShort-term trend & momentum filter";
                        else if (tag === "EMA50") tip = "EMA (50): " + sPriceText + "\nStructural trend support / resistance";
                        else if (tag === "EMA100") tip = "EMA (100): " + sPriceText + "\nIntermediate trend baseline";
                        else if (tag === "EMA200") tip = "EMA (200): " + sPriceText + "\nInstitutional trend divisor & macro filter";

                        candidateChips.push({ sPriceText, tag, sColor, sY, tip, title: s.title || tag, meta: { type: "ma", tag, title: s.title || tag, price: lastVal }, priority: 1 });
                    }
                }
            }

            // Cluster & merge Moving Average chips within 14px vertically
            const doMergeChips = typeof window === "undefined" || window.__VELA_LABEL_MERGE__ !== false;
            const finalChips: any[] = [];
            if (!doMergeChips) {
                for (const c of candidateChips) finalChips.push(c);
            } else {
                candidateChips.sort((a, b) => a.sY - b.sY);
                const MERGE_PX = 14;
                let aIdx = 0;
                while (aIdx < candidateChips.length) {
                    let bIdx = aIdx + 1;
                    while (bIdx < candidateChips.length && candidateChips[bIdx].sY - candidateChips[aIdx].sY <= MERGE_PX) {
                        bIdx++;
                    }
                    const grp = candidateChips.slice(aIdx, bIdx);
                    if (grp.length === 1) {
                        finalChips.push(grp[0]);
                    } else {
                        const primary = grp[0];
                        const mergedTag = grp.map((g) => g.tag).join("·");
                        const avgY = Math.round(grp.reduce((acc, g) => acc + g.sY, 0) / grp.length);
                        const mergedTip = grp.map((g) => g.tip).filter(Boolean).join("\n──────\n");
                        const mergedTitle = grp.map((g) => g.title).join(" + ");
                        const mergedMeta = { type: "merged", group: grp.map((g) => g.meta) };
                        finalChips.push({ sPriceText: primary.sPriceText, tag: mergedTag, sColor: primary.sColor, sY: avgY, tip: mergedTip, title: mergedTitle, meta: mergedMeta });
                    }
                    aIdx = bIdx;
                }
            }

            // Price-scale label alignment — parity with lightweight-charts' PriceAxisWidget
            // (_alignLabels / recalculateOverlapping), which is what the original AetherTrade axis
            // does: the current-price label is the fixed centre; every other label keeps its own
            // price position unless it would collide, in which case labels above the centre are
            // pushed upward and labels below are pushed downward, each stacking on its neighbour.
            // The centre block here is the ticker price chip plus the countdown pill beneath it.
            {
                const CHIP_H = 16;
                const GAP = 1;
                const paneTop = pricePane.bounds.top;
                const paneBottom = paneTop + pricePane.bounds.height;
                const tickerTop = Math.round(y - CHIP_H / 2);
                const tickerHasLabel = !!scene.showPriceLabel;
                const tickerHasCd = !!scene.showCountdown && coords.barInterval > 0;
                const fixedTop = tickerTop;
                const fixedBottom = tickerTop + (tickerHasLabel ? CHIP_H : 0) + (tickerHasCd ? 15 : 0);
                const hasFixed = fixedBottom > fixedTop;
                const centerY = (fixedTop + fixedBottom) / 2;
                const above = finalChips.filter((c) => c.sY <= centerY).sort((a, b) => b.sY - a.sY);
                const below = finalChips.filter((c) => c.sY > centerY).sort((a, b) => a.sY - b.sY);
                let limit = hasFixed ? fixedTop - GAP : Infinity;
                for (const c of above) {
                    if (c.sY + CHIP_H / 2 > limit) c.sY = limit - CHIP_H / 2;
                    limit = c.sY - CHIP_H / 2 - GAP;
                }
                limit = hasFixed ? fixedBottom + GAP : -Infinity;
                for (const c of below) {
                    if (c.sY - CHIP_H / 2 < limit) c.sY = limit + CHIP_H / 2;
                    limit = c.sY + CHIP_H / 2 + GAP;
                }
                for (const c of finalChips) {
                    if (c.sY - CHIP_H / 2 < paneTop || c.sY + CHIP_H / 2 > paneBottom) continue;
                    drawChip(c.sPriceText, c.tag, c.sColor, c.sY, c.tip, c.title, c.meta);
                }
            }
        }

        // 2. Current Price Line across the chart
        let rawSym = ((scene as any).symbol || (typeof window !== "undefined" && window.__VELA_SYMBOL__) || "").replace(/^aether:/i, "").trim().toUpperCase();
        if (rawSym && !rawSym.startsWith("$")) rawSym = "$" + rawSym;
        const tickerTag = rawSym || "$NQ";

        // Split chip styling: dark slate for price box & ticker tag (#414b5c) // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
        const chipBg = "#414b5c"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
        const chipFg = "#ffffff"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)

        ctx.font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        ctx.textBaseline = "middle";

        const priceText = formatAxisValue(pricePane.scale, pricePane.bounds.height, last.close, percentScaleFor(scene, pricePane), scene.priceMintick);
        const wPrice = Math.max(ctx.measureText(priceText).width + 8, 62);
        const wTicker = Math.max(ctx.measureText(tickerTag).width + 8, 36);
        const chipH = 16;
        const top = Math.round(y - chipH / 2);

        if (scene.showPriceLine) {
            const yy = Math.round(y) + 0.5;
            ctx.strokeStyle = chipBg;
            ctx.lineWidth = 1;
            setDash(ctx, "dotted");
            ctx.beginPath();
            if (isLeft) {
                const lineStartX = axisW + 1 + wTicker;
                ctx.moveTo(lineStartX, yy);
                ctx.lineTo(fullW, yy);
            } else {
                const lineEndX = dataW - 1 - wTicker;
                ctx.moveTo(0, yy);
                ctx.lineTo(lineEndX, yy);
            }
            ctx.stroke();
            setDash(ctx, "solid");
        }

        const interval = coords.barInterval;
        const showCountdown = scene.showCountdown && interval > 0;
        const showLabel = scene.showPriceLabel;
        if (!showLabel && !showCountdown) return;

        if (showLabel) {
            let xPrice, xTicker;
            if (isLeft) {
                // Price box on axis gutter
                xPrice = axisW - 1 - wPrice;
                ctx.fillStyle = chipBg;
                ctx.fillRect(xPrice, top, wPrice, chipH);
                ctx.fillStyle = chipFg;
                ctx.textAlign = "center";
                ctx.fillText(priceText, xPrice + wPrice / 2, top + chipH / 2);

                // Attached Ticker tag on chart canvas
                xTicker = axisW + 1;
                ctx.fillStyle = chipBg;
                ctx.fillRect(xTicker, top, wTicker, chipH);
                ctx.fillStyle = chipFg;
                ctx.textAlign = "center";
                ctx.fillText(tickerTag, xTicker + wTicker / 2, top + chipH / 2);
            } else {
                // Attached Ticker tag on chart canvas
                xTicker = dataW - 1 - wTicker;
                ctx.fillStyle = chipBg;
                ctx.fillRect(xTicker, top, wTicker, chipH);
                ctx.fillStyle = chipFg;
                ctx.textAlign = "center";
                ctx.fillText(tickerTag, xTicker + wTicker / 2, top + chipH / 2);

                // Price box on axis gutter
                xPrice = dataW + 1;
                ctx.fillStyle = chipBg;
                ctx.fillRect(xPrice, top, wPrice, chipH);
                ctx.fillStyle = chipFg;
                ctx.textAlign = "center";
                ctx.fillText(priceText, xPrice + wPrice / 2, top + chipH / 2);
            }

            chipBounds.push({
                tag: tickerTag,
                title: "Current Market Price",
                priceText: priceText,
                tooltip: tickerTag + ": " + priceText + "\nLive Last Traded Price",
                color: chipBg,
                boxPrice: { x: xPrice, y: top, w: wPrice, h: chipH },
                boxTag: { x: xTicker, y: top, w: wTicker, h: chipH },
                meta: { type: "ticker", symbol: tickerTag, price: last.close },
            });
        }

        // Countdown timer pill directly below price box on axis gutter
        if (showCountdown && interval > 0) {
            const now = Date.now();
            const steps = Math.max(Math.floor((now - last.time) / interval) + 1, 0);
            const target = last.time + steps * interval;
            const remainingMs = Math.max(0, target - now);
            const cdText = formatCountdown(remainingMs);

            ctx.font = `600 ${Math.max(9, (scene.style?.fontSize ?? 11) - 2)}px ${theme.fontFamily}`;
            const wCd = ctx.measureText(cdText).width + 8;
            const cdH = 14;
            const cdTop = top + chipH + 1;

            if (isLeft) {
                const xCd = axisW - 1 - wCd;
                ctx.fillStyle = "#2e151e"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
                ctx.fillRect(xCd, cdTop, wCd, cdH);
                ctx.strokeStyle = "rgba(255, 112, 154, 0.35)";
                ctx.lineWidth = 1;
                ctx.strokeRect(xCd + 0.5, cdTop + 0.5, wCd - 1, cdH - 1);
                ctx.fillStyle = "#ff8da8"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
                ctx.textAlign = "center";
                ctx.fillText(cdText, xCd + wCd / 2, cdTop + cdH / 2 + 0.5);
            } else {
                const xCd = dataW + 1;
                ctx.fillStyle = "#2e151e"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
                ctx.fillRect(xCd, cdTop, wCd, cdH);
                ctx.strokeStyle = "rgba(255, 112, 154, 0.35)";
                ctx.lineWidth = 1;
                ctx.strokeRect(xCd + 0.5, cdTop + 0.5, wCd - 1, cdH - 1);
                ctx.fillStyle = "#ff8da8"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
                ctx.textAlign = "center";
                ctx.fillText(cdText, xCd + wCd / 2, cdTop + cdH / 2 + 0.5);
            }
        }

        if (typeof window !== "undefined") {
            this.aetherChipBounds = chipBounds;
        }

        ctx.textAlign = "start";
    }
    drawVisibleRangeHighLow(ctx: any, scene: any, coords: any, theme: any, dataW: any, pricePane: any) {
        const showHighLow = typeof window === "undefined" || window.__VELA_HIGH_LOW__ !== false;
        if (!showHighLow || !pricePane || scene.bars.length === 0 || pricePane.collapsed || pricePane.bounds.height <= 0) return;
        const lr = coords.visibleLogicalRange ? coords.visibleLogicalRange() : null;
        if (!lr) return;
        const from = Math.max(0, Math.floor(lr.from));
        const to = Math.min(scene.bars.length - 1, Math.ceil(lr.to));
        if (from > to) return;
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = from; i <= to; i++) {
            const b = scene.bars[i];
            if (b) {
                if (b.high > hi) hi = b.high;
                if (b.low < lo) lo = b.low;
            }
        }
        if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;
        const hiY = coords.priceToY(hi, pricePane.scale, pricePane.bounds);
        const loY = coords.priceToY(lo, pricePane.scale, pricePane.bounds);
        const last = scene.bars[scene.bars.length - 1];
        const curY = (scene.showPriceLabel || scene.showCountdown) && last ? coords.priceToY(last.close, pricePane.scale, pricePane.bounds) : -999;
        const isLeft = typeof window !== "undefined" && window.__VELA_SCALE_SIDE__ === "left";
        const fullW = ctx.canvas.width / coords.dpr;
        const axisW = fullW - dataW;
        const PAD = 8;
        const hiText = "H " + formatAxisValue(pricePane.scale, pricePane.bounds.height, hi, percentScaleFor(scene, pricePane), scene.priceMintick);
        const loText = "L " + formatAxisValue(pricePane.scale, pricePane.bounds.height, lo, percentScaleFor(scene, pricePane), scene.priceMintick);
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        const fontSize = Math.max(9, (scene.style?.fontSize ?? 11) - 1);
        ctx.font = `600 ${fontSize}px ${theme.fontFamily}`;

        if (hiY >= pricePane.bounds.top && hiY <= pricePane.bounds.top + pricePane.bounds.height && Math.abs(hiY - curY) >= 14) {
            const wHi = ctx.measureText(hiText).width + PAD;
            const xHi = isLeft ? axisW - 1 - wHi : dataW + 1;
            ctx.fillStyle = "#111824"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
            ctx.fillRect(xHi, hiY - 8, wHi, 16);
            ctx.strokeStyle = "rgba(90, 161, 255, 0.45)";
            ctx.lineWidth = 1;
            ctx.strokeRect(xHi + 0.5, hiY - 7.5, wHi - 1, 15);
            ctx.fillStyle = "#9dbad9"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
            ctx.fillText(hiText, xHi + wHi / 2, hiY + 0.5);
        }

        if (loY >= pricePane.bounds.top && loY <= pricePane.bounds.top + pricePane.bounds.height && Math.abs(loY - curY) >= 14 && Math.abs(loY - hiY) >= 14) {
            const wLo = ctx.measureText(loText).width + PAD;
            const xLo = isLeft ? axisW - 1 - wLo : dataW + 1;
            ctx.fillStyle = "#22141a"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
            ctx.fillRect(xLo, loY - 8, wLo, 16);
            ctx.strokeStyle = "rgba(255, 112, 154, 0.45)";
            ctx.lineWidth = 1;
            ctx.strokeRect(xLo + 0.5, loY - 7.5, wLo - 1, 15);
            ctx.fillStyle = "#cca0af"; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
            ctx.fillText(loText, xLo + wLo / 2, loY + 0.5);
        }
        ctx.textAlign = "start";
    }

    /**
     * The color of the latest price element for the active chart style — matches how the
     * series itself is drawn: candle/bar body up-down, the line/area line color, or the
     * baseline side (above/below the baseline price).
     */
    private priceElementColor(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, last: OHLCV): string {
        const st = scene.style;
        switch (scene.priceStyle) {
            case 'bars':
                return last.close >= last.open ? (st.bars.upColor ?? theme.upColor) : (st.bars.downColor ?? theme.downColor);
            case 'line':
                return st.line.color ?? theme.upColor;
            case 'area':
                return st.area.lineColor ?? theme.upColor;
            case 'baseline': {
                const i0 = Math.max(0, Math.floor(coords.visibleLogicalRange().from));
                const baseline = scene.baselineValue ?? scene.bars[i0]?.close ?? 0;
                return last.close >= baseline ? (st.baseline.topLineColor ?? theme.upColor) : (st.baseline.bottomLineColor ?? theme.downColor);
            }
            default: // 'candles'
                return last.close >= last.open ? theme.upColor : theme.downColor;
        }
    }

    private drawTimeAxis(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, dataH: number, fullH: number): void {
        const isLeft = typeof window !== "undefined" && window.__VELA_SCALE_SIDE__ === "left";
        const fullW = ctx.canvas.width / coords.dpr;
        const axisW = fullW - dataW;
        const minX = isLeft ? axisW : 0;
        const maxX = isLeft ? fullW : dataW;
        ctx.strokeStyle = scene.style.borderColor ?? theme.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(minX, dataH + 0.5);
        ctx.lineTo(maxX, dataH + 0.5);
        ctx.stroke();
        if (!scene.showAxisLabels) return;
        ctx.fillStyle = this.axisTextColor;
        ctx.textAlign = "center";
        const y = dataH + (fullH - dataH) / 2;
        const tr = coords.visibleTimeRange();
        const offset = tzOffsetMs((tr.from + tr.to) / 2, scene.timezone);
        const target = Math.max(3, Math.min(8, Math.floor(dataW / 64)));
        const ticks = timeTicks(tr.from, tr.to, target, offset).map((tick) => ({ ...tick, x: coords.timeToX(tick.time), half: ctx.measureText(tick.label).width / 2 })).filter((tick) => tick.x >= minX + 20 && tick.x <= maxX - 20);
        const GAP = 12;
        const placed: { l: number; r: number }[] = [];
        const put = (tick: any) => {
            const l = tick.x - tick.half;
            const r = tick.x + tick.half;
            if (!placed.every((p) => r + GAP <= p.l || l - GAP >= p.r)) return;
            placed.push({ l, r });
            ctx.fillText(tick.label, tick.x, y);
        };
        for (const tick of ticks) if (tick.major) put(tick);
        for (const tick of ticks) if (!tick.major) put(tick);
        ctx.textAlign = "start";
    }
}


function unionRange(a: { min: number; max: number } | null, b: { min: number; max: number } | null): { min: number; max: number } | null {
    if (!a) return b;
    if (!b) return a;
    return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}

/**
 * White or black text for a colored price tag, biased toward white so saturated brand
 * colors (the default candle green / red sit at L≈0.22–0.24) read as white,
 * while genuinely light colors (a white or pale candle color) still get dark text. Uses
 * relative luminance with a flip point of 0.4 — higher than `readableText`'s WCAG crossover
 * (~0.18) which perceptually over-picks black on mid-tone fills. Translucent `bg` is
 * composited over `over` first so the choice reflects what's actually seen.
 */
function tagTextColor(bg: string, over: string): string {
    const [r, g, b, a] = parseColor(bg);
    let R = r;
    let G = g;
    let B = b;
    if (a < 1) {
        const [or, og, ob] = parseColor(over);
        R = r * a + or * (1 - a);
        G = g * a + og * (1 - a);
        B = b * a + ob * (1 - a);
    }
    const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
    return L >= 0.4 ? '#000000' : '#ffffff'; // palette-exempt: Aether brand chrome (price/ticker/countdown chips)
}

/** `M:SS` (or `H:MM:SS` past an hour) for the ms remaining until the bar closes; clamped at 0. */
function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (v: number): string => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

