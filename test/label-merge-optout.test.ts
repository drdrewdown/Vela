import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET } from '../src/renderers/shared/DrawingSceneRenderer';
import type { DrawingLabel } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

/**
 * A label that says `merge: false` never joins a merged cluster. The renderer's merge folds
 * neighbouring labels into one tag ("A·B") so a crowded chart stays legible — but a signal
 * study's Long / Short bubbles are the point of the chart, and a merged "Long·FVG" at a wide
 * zoom hides the signal the trader is looking for. Such a label paints where it is; the
 * labels around it still merge with each other.
 */

function recordingCtx() {
    const texts: string[] = [];
    const ctx = {
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        textAlign: 'left',
        textBaseline: 'alphabetic',
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arcTo() {},
        arc() {},
        rect() {},
        clip() {},
        fill() {},
        stroke() {},
        fillRect() {},
        strokeRect() {},
        setLineDash() {},
        strokeText() {},
        measureText: () => ({ width: 20 }),
        fillText(text: string) {
            texts.push(text);
        },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const theme = { textColor: '#e0e0e0', fontFamily: 'sans-serif' } as unknown as VelaTheme;

function label(id: string, x: number, over: Partial<DrawingLabel> = {}): DrawingLabel {
    return {
        id,
        paneId: 'price',
        xloc: 'bar_index',
        x,
        y: 50,
        yloc: 'price',
        text: id,
        style: 'label_down',
        color: '#2962ff',
        size: 'normal',
        textAlign: 'center',
        fontFamily: 'default',
        ...over,
    };
}

/** Paint the labels with the merge on; px = x (identity), py = 100 − y. */
function paint(labels: DrawingLabel[]): string[] {
    const r = new DrawingSceneRenderer({ timeToLogical: (ms) => ms, barAt: () => null, theme, mergeLabels: () => true });
    r.setSet({ ...EMPTY_DRAWING_SET, labels });
    const { ctx, texts } = recordingCtx();
    r.render(ctx, 400, 100, (l) => l, (p) => 100 - p);
    return texts;
}

describe('a label can opt out of the merge', () => {
    it('two neighbours merge into one tag by default', () => {
        expect(paint([label('A', 100), label('B', 110)])).toEqual(['A·B']);
    });

    it('merge: false keeps the label its own, and its neighbours still merge with each other', () => {
        const texts = paint([label('A', 100, { merge: false }), label('B', 110), label('C', 118)]);
        expect(texts).toHaveLength(2);
        expect(texts).toContain('A');
        expect(texts).toContain('B·C');
    });

    it('a pinned price chip honours it too', () => {
        const chip = (id: string, over: Partial<DrawingLabel> = {}) => label(id, 380, { style: 'label_left', text: `${id} 50`, ...over });
        expect(paint([chip('SL'), chip('TP1')])).toHaveLength(1);
        expect(paint([chip('SL', { merge: false }), chip('TP1')])).toHaveLength(2);
    });
});
