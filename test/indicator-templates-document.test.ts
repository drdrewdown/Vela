// The indicator templates in the state document: a SHARED preference (one list per shell)
// of named indicator ledgers, validated like a cell's ledger, unique by name, capped — and
// additive: a document written before the field existed decodes exactly as it did.
import { describe, it, expect } from 'vitest';

import { MAX_INDICATOR_TEMPLATES, sanitizeState, encodeState, decodeState } from '../src/state/document';

const base = { version: 1 as const, layout: '1', charts: [] };
const ledger = { manifest: ['Williams Fractal'], natives: ['volume', { type: 'sma', inputs: { length: 50 }, hidden: true }] };
const tpl = (name: string, extra: Record<string, unknown> = {}) => ({ name, indicators: ledger, createdAt: 1, updatedAt: 2, ...extra });

describe('indicator templates in the state document', () => {
    it('round-trips a template with its ledger, interval and symbol', () => {
        const doc = { ...base, indicatorTemplates: [tpl('Scalp', { timeframe: '1', symbol: 'CME:ES' })] };
        const back = decodeState(encodeState(sanitizeState(doc)!))!;
        expect(back.indicatorTemplates).toEqual([{ name: 'Scalp', indicators: ledger, timeframe: '1', symbol: 'CME:ES', createdAt: 1, updatedAt: 2 }]);
    });

    it('a document without the field decodes without it', () => {
        expect(sanitizeState(base)!.indicatorTemplates).toBeUndefined();
        expect(sanitizeState({ ...base, indicatorTemplates: [] })!.indicatorTemplates).toBeUndefined();
    });

    it('drops an entry without a name or a ledger, and validates the ledger like a cell\'s', () => {
        const doc = {
            ...base,
            indicatorTemplates: [
                { name: '', indicators: ledger },
                { name: 'No ledger' },
                { name: 'Loose', indicators: { manifest: [42, { nope: 1 }], natives: [{ type: 'rsi', inputs: 'bad', hidden: 'yes' }, null] } },
                'not an object',
            ],
        };
        expect(sanitizeState(doc)!.indicatorTemplates).toEqual([
            { name: 'Loose', indicators: { manifest: [], natives: ['rsi'] }, createdAt: expect.any(Number), updatedAt: expect.any(Number) },
        ]);
    });

    it('keeps the first of two names that differ only in case, trimmed', () => {
        const doc = { ...base, indicatorTemplates: [tpl('  Structure '), tpl('structure'), tpl('STRUCTURE')] };
        expect(sanitizeState(doc)!.indicatorTemplates!.map((t) => t.name)).toEqual(['Structure']);
    });

    it(`keeps at most ${MAX_INDICATOR_TEMPLATES}, in document order`, () => {
        const many = Array.from({ length: MAX_INDICATOR_TEMPLATES + 3 }, (_, i) => tpl(`T${i}`));
        const kept = sanitizeState({ ...base, indicatorTemplates: many })!.indicatorTemplates!;
        expect(kept.length).toBe(MAX_INDICATOR_TEMPLATES);
        expect(kept[kept.length - 1]!.name).toBe(`T${MAX_INDICATOR_TEMPLATES - 1}`);
    });

    it('a cell\'s ledger is validated exactly as before', () => {
        const doc = { ...base, charts: [{ id: 'c1', indicators: { manifest: ['Fractal', { name: 'X', props: { a: 1 } }], natives: [{ type: 'volume' }, { type: 'ema', inputs: { length: 9 } }] } }] };
        expect(sanitizeState(doc)!.charts[0]!.indicators).toEqual({ manifest: ['Fractal', { name: 'X', props: { a: 1 } }], natives: ['volume', { type: 'ema', inputs: { length: 9 } }] });
    });
});
