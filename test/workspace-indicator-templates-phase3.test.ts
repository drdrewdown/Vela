// @vitest-environment jsdom
// Indicator templates, the rest of the feature: the list as a JSON file in and out, a saved chip
// moved by dragging, Alt+1 … Alt+0 applying the strip's first ten, and the mobile drawer's
// Templates view.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { MAX_INDICATOR_TEMPLATES } from '../src/state/document';
import { moveTemplate } from '../src/workspace/indicator-templates';
import { addMenuRows } from '../src/widget/template-strip';
import { MoreDrawer } from '../src/widget/more-drawer';

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
const tpl = (name: string, natives: string[] = ['volume']) => ({ name, indicators: { manifest: [], natives }, createdAt: 1, updatedAt: 1 });

describe('export and import', () => {
    it('round-trips the saved list through the JSON document, merging by name and honouring the cap', () => {
        const { ws } = mount();
        ws.setActiveCell('c1');
        ws.cell('c1')!.chart.addNativeIndicator('sma');
        ws.saveIndicatorTemplate('Mine');
        const json = ws.exportIndicatorTemplates();
        expect(JSON.parse(json)).toMatchObject({ version: 1, indicatorTemplates: [{ name: 'Mine', indicators: { natives: ['sma'] } }] });

        const other = mount().ws;
        other.setActiveCell('c1');
        other.saveIndicatorTemplate('Theirs');
        let announced = 0;
        other.on('indicators:templates', () => announced++);
        expect(other.importIndicatorTemplates(json)).toEqual({ added: 1, replaced: 0, rejected: 0 });
        expect(other.indicatorTemplates().map((t) => t.name)).toEqual(['Theirs', 'Mine']);
        expect(announced).toBe(1);
        // a second import of the same name updates it in place; a bad entry is counted, not taken
        expect(other.importIndicatorTemplates(JSON.stringify([tpl('mine', ['rsi']), { name: '', indicators: {} }]))).toEqual({ added: 0, replaced: 1, rejected: 1 });
        expect(other.indicatorTemplates()[1]).toMatchObject({ name: 'mine', indicators: { natives: ['rsi'] }, createdAt: expect.any(Number) });
        // replace swaps the whole list; the cap holds
        const many = Array.from({ length: MAX_INDICATOR_TEMPLATES + 2 }, (_, i) => tpl(`T${i}`));
        expect(other.importIndicatorTemplates(JSON.stringify(many), 'replace')).toEqual({ added: MAX_INDICATOR_TEMPLATES, replaced: 0, rejected: 2 });
        expect(other.indicatorTemplates().length).toBe(MAX_INDICATOR_TEMPLATES);
        expect(other.importIndicatorTemplates('not json')).toEqual({ added: 0, replaced: 0, rejected: 0 });
    });

    it('the + chip offers export only once something is saved, and import always', () => {
        expect(addMenuRows(false).map((r) => [r.id, r.disabled ?? false])).toEqual([['export', true], ['import', false]]);
        expect(addMenuRows(true)[0]!.disabled).toBe(false);
    });
});

describe('order', () => {
    it('a saved chip dragged onto another moves to its place, and the order persists', () => {
        const { ws, host } = mount();
        ws.setActiveCell('c1');
        for (const n of ['A', 'B', 'C']) ws.saveIndicatorTemplate(n);
        const [a, , c] = chips(host);
        expect(a!.draggable).toBe(true);
        a!.dispatchEvent(new Event('dragstart'));
        c!.dispatchEvent(new Event('drop', { cancelable: true }));
        expect(ws.indicatorTemplates().map((t) => t.name)).toEqual(['B', 'C', 'A']);
        expect(chips(host).map((b) => b.dataset.name)).toEqual(['B', 'C', 'A']);
        expect(JSON.parse(JSON.stringify(ws.getState())).indicatorTemplates.map((t: { name: string }) => t.name)).toEqual(['B', 'C', 'A']);
        expect(ws.moveIndicatorTemplate('zzz', 0)).toBe(false);
    });

    it('the pure move clamps and keeps the rest in order', () => {
        const list = [tpl('A'), tpl('B'), tpl('C')];
        expect(moveTemplate(list, 'C', 0)!.map((t) => t.name)).toEqual(['C', 'A', 'B']);
        expect(moveTemplate(list, 'A', 99)!.map((t) => t.name)).toEqual(['B', 'C', 'A']);
        expect(moveTemplate(list, 'nope', 0)).toBeNull();
    });
});

describe('shortcuts', () => {
    it('Alt+1 … Alt+0 apply the first ten saved templates in the strip\'s order', () => {
        const { ws } = mount({ indicatorTemplates: [tpl('Preset', ['rsi'])] });
        ws.setActiveCell('c1');
        const c1 = ws.cell('c1')!;
        c1.chart.addNativeIndicator('sma');
        ws.saveIndicatorTemplate('First');
        c1.chart.indicators().forEach((h) => h.remove());
        c1.chart.addNativeIndicator('ema');
        ws.saveIndicatorTemplate('Second');
        expect(ws.keymap.bindings().filter((b) => b.id.startsWith('templates.apply-')).map((b) => b.keys[0])).toEqual(['alt+1', 'alt+2', 'alt+3', 'alt+4', 'alt+5', 'alt+6', 'alt+7', 'alt+8', 'alt+9', 'alt+0']);
        ws.keymap.handleKeydown(new KeyboardEvent('keydown', { key: '1', altKey: true, cancelable: true }));
        expect(c1.chart.indicators().map((h) => h.nativeType)).toEqual(['sma']);
        ws.keymap.handleKeydown(new KeyboardEvent('keydown', { key: '2', altKey: true, cancelable: true }));
        expect(c1.chart.indicators().map((h) => h.nativeType)).toEqual(['ema']);
        ws.keymap.handleKeydown(new KeyboardEvent('keydown', { key: '3', altKey: true, cancelable: true }));    // no third: nothing changes
        expect(c1.chart.indicators().map((h) => h.nativeType)).toEqual(['ema']);
    });
});

describe('the mobile drawer', () => {
    it('lists the templates under a Templates row and applies one on tap', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const onApply = vi.fn();
        const drawer = new MoreDrawer({
            host, canUndo: () => false, canRedo: () => false, priceStyles: () => [{ id: 'candles', label: 'Candles' }], priceStyle: () => 'candles', onPriceStyle: () => {},
            panels: () => [], onTogglePanel: () => {}, actions: () => [],
            templates: { rows: () => [{ name: 'Scalp', builtIn: false, active: true }, { name: 'Clean', builtIn: true, active: false }], onApply },
        });
        drawer.open();
        const rowOf = (label: string) => [...host.querySelectorAll<HTMLElement>('.vela-md-row')].find((r) => r.querySelector('.vela-md-row-label')?.textContent === label);
        const templatesRow = rowOf('Templates')!;
        expect(templatesRow.querySelector('.vela-md-row-value')!.textContent).toBe('Scalp');
        templatesRow.click();
        expect(host.querySelector('.vela-md-back')!.textContent).toContain('Templates');
        expect([...host.querySelectorAll('.vela-md-section')].map((e) => e.textContent)).toEqual(['Built-in']);
        rowOf('Clean')!.click();
        expect(onApply).toHaveBeenCalledWith('Clean');
        drawer.destroy();
    });
});
