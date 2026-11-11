// @vitest-environment jsdom
// The workspace's settings templates: chart config documents saved under a name, kept in the
// state document, and handed to every cell's settings dialog as its Template menu's store.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { MAX_SETTINGS_TEMPLATES, encodeState, sanitizeSettingsTemplates, sanitizeState } from '../src/state/document';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function mount(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', volume: false, timeframe: '15', ...opts } as never);
    live.push(ws);
    return { ws, host };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const names = (ws: VelaWorkspace): string[] => ws.settingsTemplates().map((t) => t.name);

describe('sanitizeSettingsTemplates', () => {
    it('keeps named config objects, the first of a name, up to the cap', () => {
        const many = Array.from({ length: MAX_SETTINGS_TEMPLATES + 5 }, (_, i) => ({ name: `t${i}`, config: { n: i } }));
        expect(sanitizeSettingsTemplates(many)).toHaveLength(MAX_SETTINGS_TEMPLATES);
        const out = sanitizeSettingsTemplates([
            { name: ' Night ', config: { a: 1 }, createdAt: 5, updatedAt: 6 },
            { name: 'night', config: { a: 2 } },
            { name: '', config: {} },
            { name: 'NoConfig' },
            { name: 'List', config: [] },
            null,
        ])!;
        expect(out).toEqual([{ name: 'Night', config: { a: 1 }, createdAt: 5, updatedAt: 6 }]);
        expect(sanitizeSettingsTemplates([])).toBeNull();
        expect(sanitizeSettingsTemplates('x')).toBeNull();
    });

    it('rides the state document', () => {
        const st = sanitizeState({ version: 1, layout: '1', charts: [], settingsTemplates: [{ name: 'Night', config: { a: 1 } }] })!;
        expect(st.settingsTemplates!.map((t) => t.name)).toEqual(['Night']);
    });
});

describe('workspace settings templates', () => {
    it('saves a config under a name, replaces it in place, and removes it', () => {
        const { ws } = mount();
        let events = 0;
        ws.on('settings:templates', () => events++);
        expect(ws.saveSettingsTemplate('Night', { series: { spacing: 2 } })).toBe(true);
        expect(ws.saveSettingsTemplate('Day', { series: { spacing: 3 } })).toBe(true);
        expect(ws.saveSettingsTemplate(' night ', { series: { spacing: 5 } })).toBe(true);
        expect(names(ws)).toEqual(['night', 'Day']);
        expect(ws.settingsTemplates()[0]!.config).toEqual({ series: { spacing: 5 } });
        expect(ws.removeSettingsTemplate('DAY')).toBe(true);
        expect(ws.removeSettingsTemplate('Day')).toBe(false);
        expect(names(ws)).toEqual(['night']);
        expect(events).toBe(4);
    });

    it('refuses an empty name, a non-object document and a name past the cap', () => {
        const { ws } = mount();
        expect(ws.saveSettingsTemplate('  ', {})).toBe(false);
        expect(ws.saveSettingsTemplate('x', null)).toBe(false);
        expect(ws.saveSettingsTemplate('x', [])).toBe(false);
        for (let i = 0; i < MAX_SETTINGS_TEMPLATES; i++) expect(ws.saveSettingsTemplate(`t${i}`, {})).toBe(true);
        expect(ws.saveSettingsTemplate('one more', {})).toBe(false);
        expect(ws.saveSettingsTemplate('T0', { again: true })).toBe(true); // an update is not a new entry
        expect(names(ws)).toHaveLength(MAX_SETTINGS_TEMPLATES);
    });

    it('hands out copies: a caller cannot edit the saved document, nor the saver its own', () => {
        const { ws } = mount();
        const mine = { series: { spacing: 2 } };
        ws.saveSettingsTemplate('Night', mine);
        mine.series.spacing = 9;
        ws.settingsTemplates()[0]!.config.series = 'gone';
        expect(ws.settingsTemplates()[0]!.config).toEqual({ series: { spacing: 2 } });
    });

    it('applies a template to the active cell\'s chart', () => {
        const { ws } = mount();
        ws.saveSettingsTemplate('Wide', { series: { spacing: 4 } });
        expect(ws.applySettingsTemplate('wide')).toBe(true);
        expect((ws.cell('c1')!.chart.renderer.getConfig() as { series: { spacing: number } }).series.spacing).toBe(4);
        expect(ws.applySettingsTemplate('nope')).toBe(false);
    });

    it('keeps them in the state document and restores them from it', () => {
        const { ws } = mount();
        ws.saveSettingsTemplate('Night', { series: { spacing: 2 } });
        const state = ws.getState();
        expect(state.settingsTemplates!.map((t) => t.name)).toEqual(['Night']);
        // a workspace booting from a stored document starts with them
        const storage = { get: () => encodeState(state), set: () => {}, remove: () => {} };
        const again = mount({ persist: 'settings-templates-test', storage }).ws;
        expect(names(again)).toEqual(['Night']);
        const empty = mount().ws;
        empty.applyState(state);
        expect(names(empty)).toEqual(['Night']);
    });

    it('is every cell\'s Template menu: a save in the dialog lands in the list, a click applies', async () => {
        const { ws, host } = mount();
        ws.saveSettingsTemplate('Wide', { series: { spacing: 4 } });
        ws.cell('c1')!.chart.renderer.openSettings();
        host.querySelector<HTMLButtonElement>('.vela-sd-tpl-btn')!.click();
        await tick();
        const rows = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')];
        rows.find((el) => el.textContent === 'Wide')!.click();
        await tick();
        expect((ws.cell('c1')!.chart.renderer.getConfig() as { series: { spacing: number } }).series.spacing).toBe(4);
        host.querySelector<HTMLButtonElement>('.vela-sd-tpl-btn')!.click();
        await tick();
        [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) => el.textContent === 'Save as…')!.click();
        await tick();
        host.querySelector<HTMLInputElement>('.vela-sd-tpl-name input')!.value = 'Mine';
        host.querySelector<HTMLButtonElement>('.vela-sd-tpl-save')!.click();
        expect(names(ws)).toEqual(['Wide', 'Mine']);
        expect((ws.settingsTemplates()[1]!.config as { series: { spacing: number } }).series.spacing).toBe(4);
    });

    it('leaves the dialog its Reset defaults button under `settingsTemplates: false`', () => {
        const { ws, host } = mount({ settingsTemplates: false });
        ws.cell('c1')!.chart.renderer.openSettings();
        expect(host.querySelector('.vela-sd-tpl-btn')).toBeNull();
    });
});
