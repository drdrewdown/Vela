import { describe, it, expect } from 'vitest';
import { paintTable } from '../src/renderers/shared/TableCanvasRenderer';
import { DARK_THEME } from '../src/core/theme';
import type { DrawingTable, TableCell } from '../src/core/model/drawings';

// ── a cell's `minWidth` is a floor in CSS pixels under its content size: a dashboard whose
// text changes from tick to tick keeps its columns (and so its outer width) where they are ──

/** A recording 2d-context stand-in: text is six pixels a character; `fillRect` is kept. */
function fakeCtx() {
    const fills: Array<[number, number, number, number]> = [];
    const base: Record<string, unknown> = {
        fillRect(x: number, y: number, w: number, h: number) {
            fills.push([x, y, w, h]);
        },
        measureText(s: string) {
            return { width: s.length * 6 };
        },
    };
    const ctx = new Proxy(base, {
        get: (t, k: string) => (k in t ? t[k] : () => {}),
        set: (t, k: string, v) => {
            if (typeof t[k] !== 'function') t[k] = v;
            return true;
        },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

function cell(text: string, minWidth?: number): TableCell {
    return { text, textColor: '#fff', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'default', tooltip: '', bold: false, italic: false, minWidth };
}

/** The painted table's outer width — the background rect, the painter's first fill. */
function widthOf(cells: TableCell[]): number {
    const { ctx, fills } = fakeCtx();
    const t = { id: 't', paneId: '', position: 'top_left', columns: cells.length, rows: 1, bgColor: '#000', frameColor: null, frameWidth: 0, borderColor: null, borderWidth: 0, cells: [cells], merges: [] } as unknown as DrawingTable;
    paintTable(ctx, t, { paneHeight: 300, plotWidth: 700, theme: DARK_THEME }, []);
    return fills[0]![2];
}

describe('table cell minWidth', () => {
    it('holds a column at its floor whatever the text', () => {
        expect(widthOf([cell('ab', 120), cell('x', 60)])).toBe(180);
        expect(widthOf([cell('abcdefgh', 120), cell('xyz', 60)])).toBe(180);
    });

    it('content wider than the floor still sizes the column', () => {
        const natural = widthOf([cell('a'.repeat(40))]);
        expect(widthOf([cell('a'.repeat(40), 120)])).toBe(natural);
        expect(natural).toBeGreaterThan(120);
    });

    it('a cell without a floor sizes to its content as before', () => {
        expect(widthOf([cell('ab')])).toBeLessThan(widthOf([cell('abcdefgh')]));
    });
});
