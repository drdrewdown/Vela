import { describe, it, expect } from 'vitest';
import { paintTable } from '../src/renderers/shared/TableCanvasRenderer';
import { DARK_THEME } from '../src/core/theme';
import type { DrawingTable } from '../src/core/model/drawings';

// ── a table anchors to the DATA AREA: with the price scale docked left the area starts
// past the left gutter and runs to the canvas edge, so a right-anchored table sits at the
// plot's right edge and a left-anchored one clears the scale ──

/** A recording 2d-context stand-in: every method is a no-op but `fillRect` is kept. */
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

function table(position: DrawingTable['position']): DrawingTable {
    const cell = { text: 'abc', textColor: '#fff', bgColor: null, hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'default', tooltip: '', bold: false, italic: false };
    return { id: 't', paneId: '', position, columns: 1, rows: 1, bgColor: '#000', frameColor: null, frameWidth: 0, borderColor: null, borderWidth: 0, cells: [[cell]], merges: [] } as unknown as DrawingTable;
}

/** The table background's rect — the first fill the painter makes. */
function boxOf(position: DrawingTable['position'], plotLeft?: number): [number, number, number, number] {
    const { ctx, fills } = fakeCtx();
    paintTable(ctx, table(position), { paneHeight: 300, plotWidth: 700, plotLeft, theme: DARK_THEME }, []);
    return fills[0]!;
}

describe('tables under a left-docked price scale', () => {
    it('a right-anchored table reaches the data area\'s right edge', () => {
        const [x, , w] = boxOf('top_right', 64);
        expect(x + w).toBe(64 + 700 - 6);
    });

    it('a left-anchored table starts past the left gutter', () => {
        expect(boxOf('top_left', 64)[0]).toBe(64 + 6);
    });

    it('a centred table centres on the data area', () => {
        const [x, , w] = boxOf('top_center', 64);
        expect(x + w / 2).toBe(64 + 350);
    });

    it('with the scale docked right nothing moves', () => {
        const [x, , w] = boxOf('top_right');
        expect(x + w).toBe(700 - 6);
        expect(boxOf('top_left')[0]).toBe(6);
    });
});
