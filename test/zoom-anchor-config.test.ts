import { describe, expect, it } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';

// What a wheel zoom keeps pinned is chart config: a host that prefers zooming at the pointer
// sets `timeScale.zoomAnchor`, the settings dialog offers it, and it persists with the document
// like the clock format does. The `zoomAnchor` feature stays as the runtime twin.
describe('wheel zoom anchor', () => {
    it('is a config field: the latest bar by default, two values only', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.timeScale.zoomAnchor).toBe('right');
        expect(mergeConfig(base, { timeScale: { zoomAnchor: 'cursor' } }).timeScale.zoomAnchor).toBe('cursor');
        expect(mergeConfig(base, { timeScale: { zoomAnchor: 'middle' } }).timeScale.zoomAnchor).toBe('right');
        expect(mergeConfig(base, { timeScale: { hour12: true } }).timeScale.zoomAnchor).toBe('right');
    });

    it('the feature and the config are one setting, and a change reaches config listeners', () => {
        const r = new NativeRenderer();
        let notified = 0;
        r.onConfigChanged(() => notified++);
        expect(r.readFeature('zoomAnchor')).toBe('right');
        r.applyFeature('zoomAnchor', 'cursor');
        expect(r.readFeature('zoomAnchor')).toBe('cursor');
        expect(r.getConfig().timeScale.zoomAnchor).toBe('cursor');
        expect(notified).toBeGreaterThan(0);
        r.applyConfig({ timeScale: { zoomAnchor: 'right' } });
        expect(r.readFeature('zoomAnchor')).toBe('right');
    });
});
