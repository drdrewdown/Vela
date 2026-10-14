import { describe, it, expect } from 'vitest';
import { modelToValuePatch } from '../src/core/engine/EngineOrchestrator';
import type { IndicatorModel } from '../src/core/model';

// A value patch hands the renderer the series arrays by reference. Building it must cost
// O(series), never O(points) — the dirty span upstream added reads the two ENDS of each series only: a streamed native re-emits on every live tick, and a walk over
// every point of every series (24 series × 24k bars on a day-trading history) was ~7 ms of
// main-thread time per tick for a range nothing consumed.
function untouchable(n: number, allowed: readonly number[] = []): never[] {
    const arr = new Array(n).fill(null).map((_, i) => ({ time: i, value: i }));
    return new Proxy(arr, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && /^\d+$/.test(prop) && !allowed.includes(Number(prop))) throw new Error(`points[${prop}] read`);
            return Reflect.get(target, prop, receiver);
        },
    }) as never[];
}

describe('modelToValuePatch', () => {
    it('passes each series array through by reference, reading only its two ends for the dirty span', () => {
        const points = untouchable(5000, [0, 4999]);
        const model = {
            id: 'ind',
            title: 't',
            overlay: true,
            paneHint: 'price',
            series: [{ id: 'a', title: 'a', paneId: 'price', kind: 'line', points, style: { color: '#fff', width: 1, lineStyle: 'solid' } }],
            fills: [],
            backgrounds: [],
            priceLines: [],
            inputs: [],
            inputValues: {},
        } as unknown as IndicatorModel;
        const patch = modelToValuePatch(model);
        expect(patch.kind).toBe('value');
        expect(patch.series).toHaveLength(1);
        expect((patch.series[0] as { points: unknown }).points).toBe(points);
        expect(patch.dirty).toEqual({ from: 0, to: 4999 });
    });
});
