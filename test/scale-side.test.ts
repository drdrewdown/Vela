import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { LEGEND_LEFT_CSS } from '../src/renderers/shared/InputsUI';

// `priceScale.side` is the one place the scale's edge is decided; its pixel consequence is
// `coords.leftOffsetPx`, which every painter reads instead of a global.
describe('price scale side', () => {
    it('is a config field: right by default, left when asked, garbage ignored', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.priceScale.side).toBe('right');
        expect(mergeConfig(base, { priceScale: { side: 'left' } }).priceScale.side).toBe('left');
        expect(mergeConfig(base, { priceScale: { side: 'sideways' } }).priceScale.side).toBe('right');
    });

    it('is a renderer feature that round-trips through the config', () => {
        const r = new NativeRenderer();
        expect(r.readFeature('scaleSide')).toBe('right');
        r.applyFeature('scaleSide', 'left');
        expect(r.readFeature('scaleSide')).toBe('left');
        expect(r.getConfig().priceScale.side).toBe('left');
    });

    it('a left gutter shifts the x mapping by exactly the gutter, and back', () => {
        const c = new CoordinateSystem();
        c.setBars([0, 60_000, 120_000]);
        c.setSize(300, 100, 1, 0);
        const xRight = c.logicalToX(2);
        c.setSize(300, 100, 1, 60);
        expect(c.logicalToX(2)).toBe(xRight + 60);
        expect(c.xToLogical(c.logicalToX(1))).toBeCloseTo(1, 9);
    });

    it('publishes the left scale gutter for host overlays, and clears it when the scale docks right', () => {
        // Overlays that share the mount container (status line, attribution mark, cell
        // controls) anchor to the plot's edges through published CSS variables; a
        // left-docked scale is an edge too, or they overlap the axis.
        const props = new Map<string, string>();
        const host = { style: { setProperty: (k: string, v: string) => void props.set(k, v), getPropertyValue: (k: string) => props.get(k) ?? '', removeProperty: (k: string) => void props.delete(k) } };
        const renderer = new NativeRenderer();
        const r = renderer as unknown as { mountContainer: typeof host | null; rightAxisW: number; publishGutters(): void };
        r.mountContainer = host;
        renderer.applyFeature('scaleSide', 'left');
        r.publishGutters();
        expect(host.style.getPropertyValue('--vela-scale-gutter-left')).toBe(`${r.rightAxisW}px`);
        expect(host.style.getPropertyValue('--vela-scale-gutter')).toBe('0px');
        renderer.applyFeature('scaleSide', 'right');
        r.publishGutters();
        expect(host.style.getPropertyValue('--vela-scale-gutter-left')).toBe('0px');
        expect(host.style.getPropertyValue('--vela-scale-gutter')).toBe(`${r.rightAxisW}px`);
    });

    it('the legend column sits 10px into the plot, past whatever the scale reserves on the left', () => {
        expect(LEGEND_LEFT_CSS).toContain('--vela-scale-gutter-left');
        expect(LEGEND_LEFT_CSS).toContain('10px');
    });

    it("the renderer's own attribution mark clears a left-docked scale", () => {
        const renderer = new NativeRenderer();
        // The mark's ink lands through setProperty (a no-op here); its position is assigned as plain fields.
        type FakeStyle = { left?: string; bottom?: string; setProperty(k: string, v: string): void; removeProperty(k: string): void };
        const r = renderer as unknown as { attributionEl: { style: FakeStyle } | null; rightAxisW: number; positionAttribution(): void };
        const style: FakeStyle = { setProperty: () => {}, removeProperty: () => {} };
        r.attributionEl = { style };
        r.positionAttribution();
        expect(r.attributionEl.style.left).toBe('12px');
        renderer.applyFeature('scaleSide', 'left');
        r.positionAttribution();
        expect(r.attributionEl.style.left).toBe(`${r.rightAxisW + 12}px`);
    });
});
