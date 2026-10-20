// @vitest-environment jsdom
// Indicator templates in a workspace: a cell's indicator set saved under a name, applied to
// any cell as one undo step (with the remembered interval and symbol), kept as a SHARED
// preference that rides `getState()` and comes back on `applyState()`, capped at ten.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { MAX_INDICATOR_TEMPLATES } from '../src/state/document';
import { ledgersEqual, upsertTemplate, renameTemplate, removeTemplate } from '../src/workspace/indicator-templates';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
});

function mountWorkspace(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '2h', volume: false, timeframe: '60', ...opts } as never);
    live.push(ws);
    return ws;
}

const types = (ws: VelaWorkspace, id: string) => ws.cell(id)!.chart.indicators().map((h) => h.nativeType).sort();

describe('indicator templates in a workspace', () => {
    it('saves the active cell\'s set with its settings and the interval, and applies it to another cell as one undo step', () => {
        const ws = mountWorkspace();
        const c1 = ws.cell('c1')!;
        c1.chart.addNativeIndicator('sma', { inputs: { length: 50 } });
        c1.chart.addNativeIndicator('rsi').setVisible(false);
        c1.setTimeframe('5');
        ws.setActiveCell('c1');
        const saved = ws.saveIndicatorTemplate('Scalp');
        expect(saved).toMatchObject({ ok: true, replaced: false, template: { name: 'Scalp', timeframe: '5' } });
        expect(ws.indicatorTemplates()[0]!.symbol).toBeUndefined();

        const c2 = ws.cell('c2')!;
        c2.chart.addNativeIndicator('ema');
        expect(ws.applyIndicatorTemplate('Scalp', { cellId: 'c2' })).toEqual({ ok: true, cells: ['c2'], skipped: [] });
        expect(types(ws, 'c2')).toEqual(['rsi', 'sma']);
        expect(c2.chart.indicators().find((h) => h.nativeType === 'rsi')!.visible).toBe(false);
        expect(c2.chart.indicators().find((h) => h.nativeType === 'sma')!.inputValues().length).toBe(50);
        expect(c2.timeframe).toBe('5');

        c2.history.undo();
        expect(types(ws, 'c2')).toEqual(['ema']);
    });

    it('remembers the symbol only when asked, and never applies it to every cell at once', () => {
        const ws = mountWorkspace({ symbol: 'BINANCE:BTCUSDT' });
        const c1 = ws.cell('c1')!;
        c1.setSymbol('BINANCE:ETHUSDT');
        ws.setActiveCell('c1');
        ws.saveIndicatorTemplate('Eth view', { rememberSymbol: true, rememberTimeframe: false });
        expect(ws.indicatorTemplates()[0]).toMatchObject({ symbol: 'BINANCE:ETHUSDT' });
        expect(ws.indicatorTemplates()[0]!.timeframe).toBeUndefined();

        ws.applyIndicatorTemplate('Eth view', { cellId: 'c2' });
        expect(ws.cell('c2')!.symbol).toBe('BINANCE:ETHUSDT');

        ws.cell('c2')!.setSymbol('BINANCE:BTCUSDT');
        ws.applyIndicatorTemplate('Eth view', { allCells: true });
        expect(ws.cell('c2')!.symbol).toBe('BINANCE:BTCUSDT');
    });

    it('a save over an existing name updates it in place; the eleventh new name is refused', () => {
        const ws = mountWorkspace();
        ws.setActiveCell('c1');
        for (let i = 0; i < MAX_INDICATOR_TEMPLATES; i++) expect(ws.saveIndicatorTemplate(`T${i}`).ok).toBe(true);
        expect(ws.saveIndicatorTemplate('One more')).toEqual({ ok: false, reason: 'full' });
        ws.cell('c1')!.chart.addNativeIndicator('sma');
        const again = ws.saveIndicatorTemplate('t3');
        expect(again).toMatchObject({ ok: true, replaced: true, template: { name: 't3' } });
        expect(ws.indicatorTemplates().map((t) => t.name)[3]).toBe('t3');
        expect(ws.indicatorTemplates()[3]!.indicators.natives).toEqual(['sma']);
        expect(ws.indicatorTemplates().length).toBe(MAX_INDICATOR_TEMPLATES);
    });

    it('renames and removes, announcing every change', () => {
        const ws = mountWorkspace();
        let announced = 0;
        ws.on('indicators:templates', () => announced++);
        ws.setActiveCell('c1');
        ws.saveIndicatorTemplate('Alpha');
        ws.saveIndicatorTemplate('Beta');
        expect(ws.renameIndicatorTemplate('alpha', 'Gamma')).toBe(true);
        expect(ws.renameIndicatorTemplate('Gamma', 'beta')).toBe(false); // taken
        expect(ws.renameIndicatorTemplate('Gamma', '  ')).toBe(false);
        expect(ws.removeIndicatorTemplate('Beta')).toBe(true);
        expect(ws.removeIndicatorTemplate('Beta')).toBe(false);
        expect(ws.indicatorTemplates().map((t) => t.name)).toEqual(['Gamma']);
        expect(announced).toBe(4);
    });

    it('knows which template a cell shows — exactly, or drifted from the last one applied', () => {
        const ws = mountWorkspace();
        const c1 = ws.cell('c1')!;
        c1.chart.addNativeIndicator('sma', { inputs: { length: 50 } });
        ws.setActiveCell('c1');
        ws.saveIndicatorTemplate('Fifty');
        expect(ws.activeIndicatorTemplate('c1')).toEqual({ name: 'Fifty', exact: true });
        expect(ws.activeIndicatorTemplate('c2')).toBeNull();

        ws.applyIndicatorTemplate('Fifty', { cellId: 'c2' });
        expect(ws.activeIndicatorTemplate('c2')).toEqual({ name: 'Fifty', exact: true });
        ws.cell('c2')!.chart.addNativeIndicator('rsi');
        expect(ws.activeIndicatorTemplate('c2')).toEqual({ name: 'Fifty', exact: false });
        ws.removeIndicatorTemplate('Fifty');
        expect(ws.activeIndicatorTemplate('c2')).toBeNull();
    });

    it('a built-in preset applies like a saved one, does not count against the cap, and cannot be removed', () => {
        const ws = mountWorkspace({ indicatorTemplates: [{ name: 'Clean', indicators: { manifest: [], natives: ['volume'] }, createdAt: 0, updatedAt: 0 }] });
        expect(ws.builtInIndicatorTemplates().map((t) => t.name)).toEqual(['Clean']);
        expect(ws.indicatorTemplates()).toEqual([]);
        ws.cell('c1')!.chart.addNativeIndicator('sma');
        expect(ws.applyIndicatorTemplate('Clean', { cellId: 'c1' })).toMatchObject({ ok: true });
        expect(types(ws, 'c1')).toEqual(['volume']);
        expect(ws.removeIndicatorTemplate('Clean')).toBe(false);
    });

    it('a template naming a study this build does not have skips it and says so', () => {
        const ws = mountWorkspace({ indicatorTemplates: [{ name: 'Elsewhere', indicators: { manifest: [], natives: ['sma', 'no_such_study'] }, createdAt: 0, updatedAt: 0 }] });
        expect(ws.applyIndicatorTemplate('Elsewhere', { cellId: 'c1' })).toEqual({ ok: true, cells: ['c1'], skipped: ['no_such_study'] });
        expect(types(ws, 'c1')).toEqual(['sma']);
        expect(ws.applyIndicatorTemplate('Nobody')).toEqual({ ok: false, reason: 'unknown' });
    });

    it('rides the document: saved, restored into a fresh workspace, and booted from storage', () => {
        const first = mountWorkspace();
        first.cell('c1')!.chart.addNativeIndicator('rsi');
        first.setActiveCell('c1');
        first.saveIndicatorTemplate('Kept', { rememberSymbol: true });
        const saved = JSON.parse(JSON.stringify(first.getState()));
        expect(saved.indicatorTemplates).toHaveLength(1);
        expect(saved.indicatorTemplates[0]).toMatchObject({ name: 'Kept', indicators: { natives: ['rsi'] }, timeframe: '60' });

        const second = mountWorkspace();
        let announced = 0;
        second.on('indicators:templates', () => announced++);
        second.applyState(saved);
        expect(second.indicatorTemplates().map((t) => t.name)).toEqual(['Kept']);
        expect(announced).toBe(1);

        const store = new Map<string, string>();
        const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) };
        const persisted = mountWorkspace({ layout: '1', persist: 'tpl-test', storage });
        persisted.setActiveCell('c1');
        persisted.saveIndicatorTemplate('Booted');
        persisted.destroy();
        const booted = mountWorkspace({ layout: '1', persist: 'tpl-test', storage });
        expect(booted.indicatorTemplates().map((t) => t.name)).toEqual(['Booted']);
    });

    it('untouched, adds nothing to the saved document', () => {
        expect(mountWorkspace().getState().indicatorTemplates).toBeUndefined();
    });
});

describe('the pure rules', () => {
    const led = (natives: unknown[]) => ({ manifest: [], natives }) as never;
    it('compares ledgers as multisets, bare and object forms alike', () => {
        expect(ledgersEqual(led(['sma', { type: 'rsi', hidden: true }]), led([{ type: 'rsi', hidden: true }, { type: 'sma' }]))).toBe(true);
        expect(ledgersEqual(led(['sma']), led([{ type: 'sma', inputs: { length: 9 } }]))).toBe(false);
        expect(ledgersEqual(led(['sma', 'sma']), led(['sma']))).toBe(false);
        expect(ledgersEqual(led([{ type: 'sma', hidden: false }]), led(['sma']))).toBe(true);
    });
    it('upsert keeps a replaced entry\'s position and birth date; rename and remove refuse the impossible', () => {
        const a = upsertTemplate([], { name: ' A ', indicators: led([]) }, 1);
        expect(a.result).toMatchObject({ ok: true, template: { name: 'A', createdAt: 1 } });
        const b = upsertTemplate(a.list, { name: 'B', indicators: led([]) }, 2);
        const a2 = upsertTemplate(b.list, { name: 'a', indicators: led(['sma']) }, 3);
        expect(a2.list.map((t) => [t.name, t.createdAt, t.updatedAt])).toEqual([['a', 1, 3], ['B', 2, 2]]);
        expect(upsertTemplate([], { name: '', indicators: led([]) }, 1).result).toEqual({ ok: false, reason: 'empty-name' });
        expect(renameTemplate(a2.list, 'zzz', 'Q')).toBeNull();
        expect(removeTemplate(a2.list, 'zzz')).toBeNull();
    });
});
