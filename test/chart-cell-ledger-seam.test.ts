// @vitest-environment jsdom
// A cell's indicator ledger as a public seam: `indicatorLedger()` reads the set a document
// would carry, and `applyIndicatorLedger` converges the chart onto one — silently for a
// restore, or as ONE undo step (`record: true`) for an applied indicator template.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import type { LedgerNativeEntry } from '../src/widget/indicators';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
});

function mountWorkspace(): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', volume: false } as never);
    live.push(ws);
    return ws;
}

/** Natives as a sorted multiset of their persisted shapes — order on the chart is insertion order. */
const natives = (entries: readonly LedgerNativeEntry[]): string[] => entries.map((e) => JSON.stringify(e)).sort();

describe('the indicator ledger seam', () => {
    it('reads the live set with its input deltas and hidden flags', () => {
        const cell = mountWorkspace().cell('c1')!;
        cell.chart.addNativeIndicator('sma', { inputs: { length: 50 } });
        cell.chart.addNativeIndicator('rsi').setVisible(false);
        expect(natives(cell.indicatorLedger().natives)).toEqual(natives([{ type: 'sma', inputs: { length: 50 } }, { type: 'rsi', hidden: true }]));
    });

    it('converges onto a ledger: keeps and retunes, removes the surplus, adds the shortfall', () => {
        const cell = mountWorkspace().cell('c1')!;
        cell.chart.addNativeIndicator('sma', { inputs: { length: 50 } });
        cell.chart.addNativeIndicator('rsi');
        cell.applyIndicatorLedger({ manifest: [], natives: ['volume', { type: 'sma', inputs: { length: 9 } }] });
        expect(natives(cell.indicatorLedger().natives)).toEqual(natives(['volume', { type: 'sma', inputs: { length: 9 } }]));
        expect(cell.chart.indicators().map((h) => h.nativeType).sort()).toEqual(['sma', 'volume']);
    });

    it('a recorded apply is one undo step that brings the previous ledger back, and a redo re-applies it', () => {
        const cell = mountWorkspace().cell('c1')!;
        cell.chart.addNativeIndicator('sma', { inputs: { length: 50 } });
        cell.chart.addNativeIndicator('rsi');
        const before = cell.indicatorLedger();
        const template = { manifest: [], natives: ['volume', { type: 'ema', inputs: { length: 21 } }] };
        cell.applyIndicatorLedger(template, { record: true });
        expect(natives(cell.indicatorLedger().natives)).toEqual(natives(template.natives));

        cell.history.undo();
        expect(natives(cell.indicatorLedger().natives)).toEqual(natives(before.natives));
        expect(cell.chart.indicators().length).toBe(2);

        cell.history.redo();
        expect(natives(cell.indicatorLedger().natives)).toEqual(natives(template.natives));
    });

    it('a silent apply records nothing', () => {
        const cell = mountWorkspace().cell('c1')!;
        cell.applyIndicatorLedger({ manifest: [], natives: ['volume'] });
        expect(cell.history.canUndo).toBe(false);
    });
});
