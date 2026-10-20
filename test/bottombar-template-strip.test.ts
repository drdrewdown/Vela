// @vitest-environment jsdom
// The template strip in the bottom bar: a chip per saved template and per preset, the one
// the active chart shows highlighted, a click applies, the `+` saves through the dialog,
// and a host can leave the strip out.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { chipLabel, chipTooltip, templateMenuRows } from '../src/widget/template-strip';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
});

function mount(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', volume: false, timeframe: '15', ...opts } as never);
    live.push(ws);
    return { ws, host };
}

const chips = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.vela-bb-template')];
const names = (host: HTMLElement) => chips(host).map((c) => c.dataset.name);

describe('the template strip', () => {
    it('shows the saved templates, then the presets after a divider, and highlights the one the chart shows', async () => {
        const { ws, host } = mount({ indicatorTemplates: [{ name: 'Clean', indicators: { manifest: [], natives: ['volume'] }, createdAt: 0, updatedAt: 0 }] });
        ws.cell('c1')!.chart.addNativeIndicator('sma');
        ws.setActiveCell('c1');
        ws.saveIndicatorTemplate('Mine');
        expect(names(host)).toEqual(['Mine', 'Clean']);
        expect(host.querySelectorAll('.vela-bb-template-sep').length).toBe(1);
        expect(chips(host)[0]!.dataset.active).toBe('1');
        expect(chips(host)[1]!.dataset.builtin).toBe('1');
        expect(chips(host)[0]!.querySelector('.vela-bb-template-tf')!.textContent).toBe('15m');

        ws.cell('c1')!.chart.addNativeIndicator('rsi');
        await new Promise((r) => setTimeout(r, 0)); // the chart announces the add on its own tick
        expect(chips(host)[0]!.dataset.active).toBeUndefined();
        expect(chips(host)[0]!.dataset.drifted).toBe('1');
    });

    it('a click applies the template to the active chart', () => {
        const { ws, host } = mount({ indicatorTemplates: [{ name: 'Clean', indicators: { manifest: [], natives: ['volume'] }, createdAt: 0, updatedAt: 0 }] });
        ws.cell('c1')!.chart.addNativeIndicator('sma');
        chips(host)[0]!.click();
        expect(ws.cell('c1')!.chart.indicators().map((h) => h.nativeType)).toEqual(['volume']);
        expect(chips(host)[0]!.dataset.active).toBe('1');
    });

    it('the + saves the active chart\'s set under the typed name, remembering the interval by default', () => {
        const { ws, host } = mount();
        ws.cell('c1')!.chart.addNativeIndicator('ema');
        ws.setActiveCell('c1');
        host.querySelector<HTMLButtonElement>('.vela-bb-template-add')!.click();
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Template name"]')!;
        input.value = 'Fast';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(ws.indicatorTemplates()).toMatchObject([{ name: 'Fast', timeframe: '15', indicators: { natives: ['ema'] } }]);
        expect(names(host)).toEqual(['Fast']);
    });

    it('the + is disabled once ten are saved', () => {
        const { ws, host } = mount();
        ws.setActiveCell('c1');
        for (let i = 0; i < 10; i++) ws.saveIndicatorTemplate(`T${i}`);
        expect(host.querySelector<HTMLButtonElement>('.vela-bb-template-add')!.disabled).toBe(true);
        ws.removeIndicatorTemplate('T0');
        expect(host.querySelector<HTMLButtonElement>('.vela-bb-template-add')!.disabled).toBe(false);
    });

    it('a host can leave the strip out', () => {
        const { host } = mount({ indicatorTemplateStrip: false });
        expect(host.querySelector('.vela-bb-templates')).toBeNull();
        expect(host.querySelector('.vela-widget-bottombar')).not.toBeNull();
    });
});

describe('the chip\'s label, tooltip and menu', () => {
    it('cuts a long name with an ellipsis and keeps a short one', () => {
        expect(chipLabel('Scalp')).toBe('Scalp');
        expect(chipLabel('A very long template name')).toBe('A very long t…');
    });
    it('the tooltip lists the studies and what is remembered', () => {
        const tip = chipTooltip({ name: 'S', builtIn: false, timeframe: '5', symbol: 'CME:ES', studies: ['RSI', 'Volume'], state: null });
        expect(tip.split('\n')).toEqual(['S', 'RSI, Volume', 'Remembers interval 5m and symbol CME:ES']);
        expect(chipTooltip({ name: 'E', builtIn: true, studies: [], state: null })).toContain('No studies');
    });
    it('a saved chip manages; a preset only copies', () => {
        expect(templateMenuRows({ name: 'S', builtIn: false, timeframe: '5', studies: [], state: null }).map((r) => r.id)).toEqual(['update', 'rename', 'timeframe', 'symbol', 'remove']);
        expect(templateMenuRows({ name: 'S', builtIn: false, timeframe: '5', studies: [], state: null }).find((r) => r.id === 'timeframe')!.checked).toBe(true);
        expect(templateMenuRows({ name: 'P', builtIn: true, studies: [], state: null }).map((r) => r.id)).toEqual(['copy']);
    });
});
