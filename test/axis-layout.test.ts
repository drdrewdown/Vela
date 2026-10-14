import { describe, expect, it } from 'vitest';

import { canvasWidthPx } from '../src/renderers/native/chrome/axisLayout';

describe('canvasWidthPx', () => {
    it('reads the canvas when the context has one, else the data span plus a left gutter', () => {
        const coords = { width: 700, leftOffsetPx: 0, dpr: 2 };
        expect(canvasWidthPx({ canvas: { width: 1600 } }, coords)).toBe(800);
        expect(canvasWidthPx({}, coords)).toBe(700);
        expect(canvasWidthPx({ canvas: null }, { width: 700, leftOffsetPx: 64, dpr: 1 })).toBe(764);
    });
});
