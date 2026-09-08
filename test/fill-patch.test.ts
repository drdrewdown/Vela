import { describe, it, expect } from 'vitest';
import { modelToValuePatch } from '../src/core/engine/EngineOrchestrator';
import { applyPatch } from '../src/renderers/native/NativeRenderer';
import type { IndicatorModel } from '../src/core/model/indicator';

// A fill between two series carries per-point colours. The value patch a live tick produces
// carried the series' points and every drawing kind but not the fills, so a streamed study's
// cloud kept the colour array it mounted with: the painter ran out of colours at the old
// length and the cloud stopped a few bars behind the line it was filling under.
function model(n: number): IndicatorModel {
    const pts = (v: number) => Array.from({ length: n }, (_, i) => ({ time: i * 60_000, value: v }));
    return {
        id: 'ind', title: 'AO', series: [
            { id: 'line', title: 'line', paneId: 'p', kind: 'line', points: pts(1) },
            { id: 'zero', title: 'zero', paneId: 'p', kind: 'line', points: pts(0) },
        ],
        fills: [{ id: 'cloud', paneId: 'p', fromSeriesId: 'line', toSeriesId: 'zero', colors: Array.from({ length: n }, () => '#123456') }],
    } as unknown as IndicatorModel;
}

describe('fills travel in a value patch', () => {
    it('modelToValuePatch carries the fills', () => {
        const p = modelToValuePatch(model(3));
        expect(p.fills?.length).toBe(1);
        expect(p.fills?.[0]?.colors?.length).toBe(3);
    });

    it('applyPatch replaces the stored fills, so the colour array grows with the series', () => {
        const stored = model(3);
        applyPatch(stored, modelToValuePatch(model(5)));
        expect(stored.series[0]?.kind === 'line' && stored.series[0].points.length).toBe(5);
        expect(stored.fills?.[0]?.colors?.length).toBe(5);
    });
});
