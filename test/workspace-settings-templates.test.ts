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

    it('renames a template, refusing an empty or a taken name', () => {
        const { ws } = mount();
        ws.saveSettingsTemplate('Night', { a: 1 });
        ws.saveSettingsTemplate('Day', { b: 2 });
        expect(ws.renameSettingsTemplate('night', ' Dusk ')).toBe(true);
        expect(ws.renameSettingsTemplate('Dusk', 'DAY')).toBe(false);
        expect(ws.renameSettingsTemplate('Dusk', '  ')).toBe(false);
        expect(ws.renameSettingsTemplate('gone', 'x')).toBe(false);
        expect(ws.renameSettingsTemplate('Dusk', 'DUSK')).toBe(true); // its own name in another case
        expect(ws.settingsTemplates().map((t) => [t.name, t.config])).toEqual([['DUSK', { a: 1 }], ['Day', { b: 2 }]]);
    });

    it('moves a template within the list', () => {
        const { ws } = mount();
        for (const n of ['A', 'B', 'C']) ws.saveSettingsTemplate(n, {});
        expect(ws.moveSettingsTemplate('a', 2)).toBe(true);
        expect(names(ws)).toEqual(['B', 'C', 'A']);
        expect(ws.moveSettingsTemplate('A', 99)).toBe(false); // already last
        expect(ws.moveSettingsTemplate('A', -5)).toBe(true);
        expect(names(ws)).toEqual(['A', 'B', 'C']);
        expect(ws.moveSettingsTemplate('gone', 0)).toBe(false);
    });

    it('exports the list as a document and imports one, merging or replacing', () => {
        const { ws } = mount();
        ws.saveSettingsTemplate('Night', { a: 1 });
        ws.saveSettingsTemplate('Day', { b: 2 });
        const file = ws.exportSettingsTemplates();
        expect((JSON.parse(file) as { version: number; settingsTemplates: Array<{ name: string }> }).settingsTemplates.map((t) => t.name)).toEqual(['Night', 'Day']);

        const other = mount().ws;
        other.saveSettingsTemplate('night', { mine: true });
        other.saveSettingsTemplate('Keep', { c: 3 });
        expect(other.importSettingsTemplates(file)).toEqual({ added: 1, replaced: 1, rejected: 0 });
        expect(other.settingsTemplates().map((t) => [t.name, t.config])).toEqual([['Night', { a: 1 }], ['Keep', { c: 3 }], ['Day', { b: 2 }]]);
        expect(other.importSettingsTemplates(file, 'replace')).toEqual({ added: 2, replaced: 0, rejected: 0 });
        expect(names(other)).toEqual(['Night', 'Day']);
        expect(other.importSettingsTemplates('not json')).toEqual({ added: 0, replaced: 0, rejected: 0 });
        expect(other.importSettingsTemplates(JSON.stringify([{ name: 'Bad' }, { name: 'Good', config: {} }]))).toEqual({ added: 1, replaced: 0, rejected: 1 });
    });

    it('offers Rename and Move in every cell\'s Template menu', async () => {
        const { ws, host } = mount();
        ws.saveSettingsTemplate('A', {});
        ws.saveSettingsTemplate('B', {});
        ws.cell('c1')!.chart.renderer.openSettings();
        host.querySelector<HTMLButtonElement>('.vela-sd-tpl-btn')!.click();
        await tick();
        const ids = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].map((el) => el.dataset.value);
        expect(ids).toEqual(expect.arrayContaining(['rename:A', 'up:B', 'down:A', 'remove:B', 'import', 'export']));
        for (const id of ['manage', 'manage:A']) {
            document.querySelector<HTMLElement>(`[role=menuitem][data-value$="--${id}:trigger"]`)!.click();
            await tick();
        }
        document.querySelector<HTMLElement>('[role=menuitem][data-value="down:A"]')!.click();
        await tick();
        expect(names(ws)).toEqual(['B', 'A']);
    });

    it('leaves the dialog its Reset defaults button under `settingsTemplates: false`', () => {
        const { ws, host } = mount({ settingsTemplates: false });
        ws.cell('c1')!.chart.renderer.openSettings();
        expect(host.querySelector('.vela-sd-tpl-btn')).toBeNull();
    });
});
