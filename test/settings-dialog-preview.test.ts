// @vitest-environment jsdom
// The chart settings dialog's preview column (`settings.preview`): a live chart beside the
// cards that redraws with every change, mounted once per opening and kept across a re-seed.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { SettingsDialog, type SettingsPreview } from '../src/renderers/native/chrome/SettingsDialog';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { DARK_THEME } from '../src/core/theme';
import type { ChartConfig } from '../src/renderers/native/core/chartConfig';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.replaceChildren();
});

interface Probe {
    hosts: HTMLElement[];
    updates: ChartConfig[];
    destroyed: number;
    factory: (host: HTMLElement) => SettingsPreview;
}

function probe(): Probe {
    const p: Probe = {
        hosts: [],
        updates: [],
        destroyed: 0,
        factory: (host) => {
            p.hosts.push(host);
            return { update: (config) => p.updates.push(config), destroy: () => { p.destroyed++; } };
        },
    };
    return p;
}

function open(setup: (dialog: SettingsDialog) => void): { host: HTMLElement; dialog: SettingsDialog; config: ChartConfig } {
    const host = document.createElement('div');
    document.body.append(host);
    const dialog = new SettingsDialog(host, DARK_THEME);
    cleanups.push(() => dialog.destroy());
    setup(dialog);
    const config = new NativeRenderer().getConfig();
    dialog.open(config, () => {});
    return { host, dialog, config };
}

describe('the settings dialog preview', () => {
    it('mounts one chart in a column beside the cards', () => {
        const p = probe();
        const { host } = open((d) => { d.setLayout('cards'); d.setPreview(p.factory); });
        const column = host.querySelector('.vela-sd-aside')!;
        expect(p.hosts).toHaveLength(1);
        expect(column.contains(p.hosts[0]!)).toBe(true);
        expect(column.previousElementSibling!.classList.contains('vela-sd-pane')).toBe(true);
        expect(host.querySelector('.vela-sd-previewed')).not.toBeNull();
    });

    it('redraws under the config it is handed', () => {
        const p = probe();
        const { dialog, config } = open((d) => { d.setLayout('cards'); d.setPreview(p.factory); });
        const next = { ...config, series: { ...config.series, style: 'line' } } as ChartConfig;
        dialog.syncPreview(next);
        expect(p.updates).toEqual([next]);
    });

    it('keeps its chart when the rows are re-seeded, and destroys it on close', () => {
        const p = probe();
        const { host, dialog, config } = open((d) => { d.setLayout('cards'); d.setPreview(p.factory); });
        dialog.refresh(config);
        expect(p.hosts).toHaveLength(1);
        expect(p.destroyed).toBe(0);
        expect(host.querySelector('.vela-sd-aside')!.contains(p.hosts[0]!)).toBe(true);
        dialog.close();
        expect(p.destroyed).toBe(1);
    });

    it('is left out of the rail layout and of the mobile presentation', () => {
        const rail = probe();
        const a = open((d) => d.setPreview(rail.factory));
        expect(rail.hosts).toHaveLength(0);
        expect(a.host.querySelector('.vela-sd-aside')).toBeNull();
        const mobile = probe();
        const b = open((d) => { d.setLayout('cards'); d.setLayoutMode('mobile'); d.setPreview(mobile.factory); });
        expect(mobile.hosts).toHaveLength(0);
        expect(b.host.querySelector('.vela-sd-aside')).toBeNull();
    });

    it('draws a chart of its own from the `settings.preview` policy', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: '1', volume: false, timeframe: '15', settings: { layout: 'cards', preview: true } } as never);
        cleanups.push(() => ws.destroy());
        ws.cell('c1')!.chart.renderer.openSettings();
        const chartHost = host.querySelector('.vela-sd-aside-chart')!;
        expect(chartHost.querySelector('canvas')).not.toBeNull();
        // The preview is a bare chart: no settings gear, no dialog of its own.
        expect(chartHost.querySelector('.vela-sd-aside')).toBeNull();
    });
});
