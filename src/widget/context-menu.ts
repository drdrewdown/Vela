// Chart context menu — right-click on the chart area. Items depend on the zone
// (price axis / time axis / chart body) and current renderer feature states; the menu
// itself is the kit Menu anchored at the pointer.
import type { Vela } from '../Vela';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { actionDisabled, actionLabel, widgetActions, withPointer, type WidgetContext } from './contributions';
import {
    bodyItems,
    invertWrite,
    paneScaleAt,
    priceAxisItems,
    scaleChoiceOf,
    scaleWrites,
    settingsSectionOf,
    arrangeMenu,
    timeAxisItems,
    type PaneScaleInfo,
    type ScaleChoice,
    type Zone,
} from './context-menu-model';

/** Approximate chrome insets used only to classify the right-clicked zone. */
const PRICE_AXIS_W = 60;
const TIME_AXIS_H = 26;

export interface ContextMenuCallbacks {
    /** Reset the view (all history, autoscale back on). */
    resetView: () => void;
    /** The display timezone the host holds (the time-axis menu checks it). */
    timezone?: () => string;
    /** Switch the display timezone through the host, so its own chrome follows. */
    setTimezone?: (zone: string) => void;
    /** Live widget context for contributed `context:*` actions. */
    getContext?: () => WidgetContext;
    /** The price and bar time under a client position — what `context:*` actions read as
     *  `ctx.pointer`. Omitted ⇒ actions get the position only. */
    pointerAt?: (point: { clientX: number; clientY: number }) => { price: number | null; time: number | null; pane: 'price' | 'study' | null };
}

export class ChartContextMenu {
    private readonly menu: Menu;
    private readonly host: HTMLElement;
    private chart: Vela | null = null;
    /** Aether: pointer position of the last right-click, for price-at-cursor trading items. */
    private lastPoint: { clientX: number; clientY: number } | null = null;
    private lastZone: Zone = 'body';
    /** The pane whose scale the open price-axis menu targets (null ⇒ the main scale). */
    private lastPane: PaneScaleInfo | null = null;
    private readonly onContextMenu = (e: MouseEvent): void => {
        e.preventDefault();
        if (!this.chart) return;
        this.lastZone = this.zoneOf(e);
        this.lastPane = this.lastZone === 'price-axis' ? this.paneAt(e) : null;
        this.lastPoint = { clientX: e.clientX, clientY: e.clientY };
        this.menu.setItems(this.itemsFor(this.lastZone));
        this.menu.openAt(e.clientX, e.clientY);
    };

    constructor(host: HTMLElement, private readonly cbs: ContextMenuCallbacks) {
        this.host = host;
        this.menu = new Menu({
            host,
            items: [],
            placement: 'bottom-start',
            // Pointer-anchored action menu: checked state reads as a leading ✓, not a
            // washed row (which would read as hover in a menu with no trigger button).
            checkmarks: true,
            onSelect: (id) => this.run(id),
        });
        host.addEventListener('contextmenu', this.onContextMenu);
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.chart = chart;
    }

    destroy(): void {
        this.host.removeEventListener('contextmenu', this.onContextMenu);
        this.menu.destroy();
    }

    private zoneOf(e: MouseEvent): Zone {
        const rect = this.host.getBoundingClientRect();
        const isLeft = this.chart?.renderer?.get("scaleSide") === "left";
        const axisW = (this.chart?.renderer as any)?.rightAxisW ?? PRICE_AXIS_W;
        if (isLeft) {
            if (e.clientX - rect.left < axisW) return "price-axis";
        } else {
            if (e.clientX - rect.left > rect.width - axisW) return "price-axis";
        }
        if (e.clientY - rect.top > rect.height - TIME_AXIS_H) return "time-axis";
        return "body";
    }

    /** The pane under the pointer, so every pane's price scale has its own menu. */
    private paneAt(e: MouseEvent): PaneScaleInfo | null {
        const panes = this.chart?.renderer.get('paneScales');
        if (!Array.isArray(panes)) return null;
        return paneScaleAt(panes as PaneScaleInfo[], e.clientY - this.host.getBoundingClientRect().top);
    }

    private flag(feature: string): boolean {
        return Boolean(this.chart?.renderer.get(feature));
    }

    /** The context handed to contributed `context:*` actions: the host's, plus the pointer. */
    private actionContext(): WidgetContext | undefined {
        const base = this.cbs.getContext?.();
        const at = this.lastPoint;
        if (!base || !at) return base;
        const under = this.cbs.pointerAt?.(at) ?? { price: null, time: null, pane: null };
        return withPointer(base, { clientX: at.clientX, clientY: at.clientY, price: under.price, time: under.time, pane: under.pane });
    }

    /** Host actions for a zone, split by placement (see `WidgetActionDescriptor.placement`). */
    private contributed(zone: Zone): { leading: MenuItemDescriptor[]; trailing: MenuItemDescriptor[] } {
        const ctx = this.actionContext();
        const leading: MenuItemDescriptor[] = [];
        const trailing: MenuItemDescriptor[] = [];
        for (const a of widgetActions(`context:${zone}`, ctx)) {
            (a.placement === 'start' ? leading : trailing).push({
                id: `action:${a.id}`,
                label: actionLabel(a, ctx),
                icon: a.icon,
                disabled: ctx ? actionDisabled(a, ctx) : a.disabled === true,
            });
        }
        return { leading, trailing };
    }

    private arranged(zone: Zone, base: MenuItemDescriptor[]): MenuItemDescriptor[] {
        const { leading, trailing } = this.contributed(zone);
        return arrangeMenu(leading, base, trailing);
    }

    private itemsFor(zone: Zone): MenuItemDescriptor[] {
        if (zone === "price-axis") {
            const pane = this.lastPane;
            const isLeft = this.chart?.renderer?.get("scaleSide") === "left";
            const isHighLow = this.chart?.renderer?.get("rangeChips") !== false;
            const baseItems = priceAxisItems({
                auto: this.chart?.renderer.get("autoScale") !== false,
                invert: pane ? pane.invert : this.flag("invertScale"),
                choice: scaleChoiceOf(pane ?? { mode: String(this.chart?.renderer.get("scaleMode") ?? "price"), log: this.flag("logScale") }),
                axisLabels: this.flag("axisLabels"),
                priceLabel: this.flag("priceLabel"),
                countdown: this.flag("countdown"),
                priceLine: this.flag("currentPriceLine")
            });
            const highLowItem = {
                id: "toggle:rangeChips",
                label: "High and low price labels",
                checked: isHighLow
            };
            const placementItem = {
                id: "scale-placement",
                label: "Scale placement",
                separatorBefore: true,
                submenu: [
                    { id: "scale-side:left", label: "Left", checked: isLeft },
                    { id: "scale-side:right", label: "Right", checked: !isLeft }
                ]
            };
            const settingsIdx = baseItems.findIndex((it) => it.id?.startsWith("settings:"));
            if (settingsIdx !== -1) {
                baseItems.splice(settingsIdx, 0, highLowItem, placementItem);
            } else {
                baseItems.push(highLowItem, placementItem);
            }
            return this.arranged(zone, baseItems);
        }
        if (zone === "time-axis") {
            const tz = this.cbs.timezone?.() ?? String(this.chart?.renderer.get("timezone") ?? "Etc/UTC");
            return this.arranged('time-axis', timeAxisItems(tz));
        }
        const chart = this.chart;
        return this.arranged('body', bodyItems({
            drawings: chart?.drawings.supported ? chart.drawings.all().length : 0,
            indicators: chart?.indicators().length ?? 0,
        }));
    }

    private run(id: string): void {
        const chart = this.chart;
        if (!chart) return;
        if (id === 'scale-side:left' || id === 'scale-side:right') {
            chart.renderer.set('scaleSide', id.endsWith(':left') ? 'left' : 'right');
            return;
        }
        if (id.startsWith("action:")) {
            const ctx = this.actionContext();
            if (ctx) widgetActions(`context:${this.lastZone}`, ctx).find((a) => a.id === id.slice("action:".length))?.run(ctx);
            return;
        }
        if (id.startsWith("toggle:")) {
            const feature = id.slice("toggle:".length);
            chart.renderer.set(feature, !this.flag(feature));
        } else if (id.startsWith("scale:")) {
            for (const [feature, value] of scaleWrites(id.slice("scale:".length) as ScaleChoice, this.lastPane)) chart.renderer.set(feature, value);
        } else if (id.startsWith("tz:")) {
            const zone = id.slice("tz:".length);
            if (this.cbs.setTimezone) this.cbs.setTimezone(zone);
            else chart.renderer.set("timezone", zone);
        } else if (id === "auto") {
            chart.renderer.set("autoScale", chart.renderer.get("autoScale") === false);
        } else if (id === "invert") {
            const pane = this.lastPane;
            const [feature, value] = invertWrite(!(pane ? pane.invert : this.flag("invertScale")), pane);
            chart.renderer.set(feature, value);
        } else if (id.startsWith("settings")) {
            chart.renderer.openSettings(settingsSectionOf(id));
        } else if (id === "reset-view") {
            this.cbs.resetView();
        } else if (id === "remove-drawings") {
            if (chart.drawings.supported) for (const d of chart.drawings.all()) chart.drawings.remove(d.id);
        } else if (id === "remove-indicators") {
            for (const handle of chart.indicators()) handle.remove();
        }
    }
}
