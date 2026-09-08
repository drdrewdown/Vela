import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

// A wick or border colour of null follows the body colour, resolved per frame by the painters.
// getConfig() reported the RESOLVED colour, and applyConfig merges over getConfig(), so any
// round-trip — a body colour change, a dialog edit of some other field, a restored document —
// froze the wicks and borders on whatever body colour was current. A theme that swapped the
// bodies then painted hollow candles with the previous theme's outlines.
describe('candle wick and border colours', () => {
    it('stay "follow the body" through a body colour change', () => {
        const r = new NativeRenderer();
        expect(r.getConfig().candles.wickUpColor).toBeNull();
        r.applyConfig({ candles: { upColor: '#00ffff', downColor: '#ff00ff' } });
        const c = r.getConfig().candles;
        expect(c.upColor).toBe('#00ffff');
        expect(c.wickUpColor).toBeNull();
        expect(c.wickDownColor).toBeNull();
        expect(c.borderUpColor).toBeNull();
        expect(c.borderDownColor).toBeNull();
    });

    it('an explicit wick colour survives a body colour change', () => {
        const r = new NativeRenderer();
        r.applyConfig({ candles: { wickUpColor: '#123456' } });
        r.applyConfig({ candles: { upColor: '#00ffff' } });
        expect(r.getConfig().candles.wickUpColor).toBe('#123456');
    });
});
