import { describe, it, expect, afterEach } from 'vitest';
import {
    registerWidgetAction,
    unregisterWidgetAction,
    widgetActions,
    actionLabel,
    actionDisabled,
    withPointer,
    type WidgetContext,
    type WidgetPointer,
} from '../src/widget/contributions';

// A context-menu action may name the price under the pointer: labels and disabled state
// resolve per render, and the context it runs with carries the pointer — while every
// live getter of the base context keeps resolving live.

function liveContext(state: { symbol: string }): WidgetContext {
    return {
        get symbol() {
            return state.symbol;
        },
        timeframe: '1',
        priceStyle: 'candles',
    } as unknown as WidgetContext;
}

const pointer: WidgetPointer = { clientX: 10, clientY: 20, price: 5001.25, time: 1_700_000_000_000 };

afterEach(() => {
    unregisterWidgetAction('t.price');
});

describe('dynamic action labels', () => {
    it('a string label is itself; a function label resolves against the context', () => {
        const ctx = liveContext({ symbol: 'ES' });
        expect(actionLabel({ label: 'Copy' }, ctx)).toBe('Copy');
        expect(actionLabel({ label: (c) => `Buy ${c.symbol}` }, ctx)).toBe('Buy ES');
        expect(actionLabel({ label: (c) => `Buy ${c.symbol}` })).toBe('');
    });

    it('disabled resolves the same way and defaults to enabled', () => {
        const ctx = liveContext({ symbol: 'ES' });
        expect(actionDisabled({}, ctx)).toBe(false);
        expect(actionDisabled({ disabled: true }, ctx)).toBe(true);
        expect(actionDisabled({ disabled: (c) => c.symbol === 'ES' }, ctx)).toBe(true);
    });

    it('a registered action keeps its function label through the registry', () => {
        registerWidgetAction({ id: 't.price', target: 'context:body', label: (c) => `@ ${c.pointer?.price ?? '—'}`, run: () => {} });
        const ctx = withPointer(liveContext({ symbol: 'ES' }), pointer);
        const [a] = widgetActions('context:body', ctx);
        expect(actionLabel(a!, ctx)).toBe('@ 5001.25');
    });
});

describe('withPointer', () => {
    it('exposes the pointer and leaves the base untouched', () => {
        const base = liveContext({ symbol: 'ES' });
        const view = withPointer(base, pointer);
        expect(view.pointer).toBe(pointer);
        expect(base.pointer).toBeUndefined();
    });

    it('keeps the live getters live — a symbol switch after the click still reads through', () => {
        const state = { symbol: 'ES' };
        const view = withPointer(liveContext(state), pointer);
        state.symbol = 'NQ';
        expect(view.symbol).toBe('NQ');
    });
});
