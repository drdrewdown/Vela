// @vitest-environment jsdom
// The chart settings dialog's Template menu (`chart.renderer.setSettingsTemplates`): the
// chart's config saved under a name, applied back with a click, removed, beside Apply defaults.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { SettingsDialog } from '../src/renderers/native/chrome/SettingsDialog';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { DARK_THEME } from '../src/core/theme';
import type { SettingsTemplateStore } from '../src/core/options';
import type { ChartConfig } from '../src/renderers/native/core/chartConfig';
import { parseSettingsTemplates, settingsTemplatesDocument } from '../src/renderers/native/chrome/settings-templates';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: SettingsDialog[] = [];
afterEach(() => {
    for (const dialog of live.splice(0)) dialog.destroy();
    document.body.replaceChildren();
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** A store over a plain map, refusing a new name past `cap`. `ordered` adds rename and move. */
function memoryStore(cap = 10, ordered = false): SettingsTemplateStore & { kept: Map<string, unknown> } {
    const kept = new Map<string, unknown>();
    const rebuild = (entries: Array<[string, unknown]>): void => {
        kept.clear();
        for (const [k, v] of entries) kept.set(k, v);
    };
    const store: SettingsTemplateStore & { kept: Map<string, unknown> } = {
        kept,
        names: () => [...kept.keys()],
        read: (name) => kept.get(name) ?? null,
        save: (name, config) => {
            if (!kept.has(name) && kept.size >= cap) return false;
            kept.set(name, config);
            return true;
        },
        remove: (name) => void kept.delete(name),
    };
    if (ordered) {
        store.rename = (from, to) => {
            if (!kept.has(from) || kept.has(to)) return false;
            rebuild([...kept].map(([k, v]) => [k === from ? to : k, v]));
            return true;
        };
        store.move = (name, toIndex) => {
            const entries = [...kept];
            const at = entries.findIndex(([k]) => k === name);
            const [entry] = entries.splice(at, 1);
            entries.splice(toIndex, 0, entry!);
            rebuild(entries);
        };
    }
    return store;
}

interface Opened {
    host: HTMLElement;
    dialog: SettingsDialog;
    config: ChartConfig;
    imported: unknown[];
    resets: number[];
    /** Open the Template menu and click the row reading `label`. */
    pick(label: string): Promise<void>;
    rows(): Promise<string[]>;
    /** Open the Template menu and list its rows' ids (branches left out). */
    ids(): Promise<string[]>;
    /** Open the Template menu, then each branch of `path`, and click the row of its last id. */
    choose(...path: string[]): Promise<void>;
}

function open(store: SettingsTemplateStore | null, current?: () => ChartConfig): Opened {
    const host = document.createElement('div');
    document.body.append(host);
    const dialog = new SettingsDialog(host, DARK_THEME);
    live.push(dialog);
    const config = new NativeRenderer().getConfig();
    dialog.setTemplates(store, current ?? (() => config));
    const imported: unknown[] = [];
    const resets: number[] = [];
    dialog.open(config, () => {}, (json) => imported.push(json), () => resets.push(1));
    const items = async (): Promise<HTMLElement[]> => {
        host.querySelector<HTMLButtonElement>('.vela-sd-tpl-btn')!.click();
        await tick();
        return [...document.querySelectorAll<HTMLElement>('[role=menuitem]')];
    };
    return {
        host,
        dialog,
        config,
        imported,
        resets,
        rows: async () => (await items()).map((el) => el.textContent ?? ''),
        ids: async () => (await items()).map((el) => el.dataset.value ?? '').filter((v) => !v.endsWith(':trigger')),
        choose: async (...path) => {
            await items();
            for (const id of path.slice(0, -1)) {
                document.querySelector<HTMLElement>(`[role=menuitem][data-value$="--${id}:trigger"]`)!.click();
                await tick();
            }
            document.querySelector<HTMLElement>(`[role=menuitem][data-value="${path[path.length - 1]}"]`)!.click();
            await tick();
        },
        pick: async (label) => {
            const row = (await items()).find((el) => el.textContent === label);
            expect(row, `no menu row "${label}"`).toBeDefined();
            row!.click();
            await tick();
        },
    };
}

const footButtons = (host: HTMLElement): string[] => [...host.querySelectorAll('[data-slot~="dialog-footer"] button, .vela-dialog-footer button')].map((b) => b.textContent ?? '');

describe('the settings dialog Template menu', () => {
    it('is absent without a store: the footer keeps Reset defaults', () => {
        const { host } = open(null);
        expect(host.querySelector('.vela-sd-tpl-btn')).toBeNull();
        expect(footButtons(host)).toContain('Reset defaults');
    });

    it('stands where Reset defaults did, and offers Apply defaults and Save as…', async () => {
        const o = open(memoryStore());
        expect(footButtons(o.host)).not.toContain('Reset defaults');
        expect(await o.rows()).toEqual(['Apply defaults', 'Save as…', 'No saved templates yet', 'Import…']);
    });

    it('applies the defaults through the reset path', async () => {
        const o = open(memoryStore());
        await o.pick('Apply defaults');
        expect(o.resets).toHaveLength(1);
    });

    it('saves the chart\'s current config under the name typed in the footer', async () => {
        const store = memoryStore();
        let current = new NativeRenderer().getConfig();
        const o = open(store, () => current);
        // an edit made after the dialog opened is what the template keeps
        current = { ...current, series: { ...current.series, style: 'line' } } as ChartConfig;
        await o.pick('Save as…');
        const name = o.host.querySelector<HTMLInputElement>('.vela-sd-tpl-name input')!;
        expect(o.host.querySelector<HTMLElement>('.vela-sd-tpl-name')!.hidden).toBe(false);
        name.value = '  Night  ';
        o.host.querySelector<HTMLButtonElement>('.vela-sd-tpl-save')!.click();
        expect(store.kept.get('Night')).toBe(current);
        expect(o.host.querySelector<HTMLElement>('.vela-sd-tpl-name')!.hidden).toBe(true);
        expect(await o.rows()).toContain('Night');
    });

    it('keeps the name field open when the store refuses the save, and closes it on Cancel', async () => {
        const store = memoryStore(0);
        const o = open(store);
        await o.pick('Save as…');
        const row = o.host.querySelector<HTMLElement>('.vela-sd-tpl-name')!;
        o.host.querySelector<HTMLInputElement>('.vela-sd-tpl-name input')!.value = 'Night';
        o.host.querySelector<HTMLButtonElement>('.vela-sd-tpl-save')!.click();
        expect(store.kept.size).toBe(0);
        expect(row.hidden).toBe(false);
        o.host.querySelector<HTMLButtonElement>('.vela-sd-tpl-cancel')!.click();
        expect(row.hidden).toBe(true);
    });

    it('applies a saved template through the import path when its row is clicked', async () => {
        const store = memoryStore();
        const saved = { series: { style: 'bars' } };
        store.kept.set('Bars', saved);
        const o = open(store);
        await o.pick('Bars');
        expect(o.imported).toEqual([saved]);
    });

    it('gives each template its own actions under Manage: what the store can do, and Remove', async () => {
        const plain = memoryStore();
        plain.kept.set('Bars', {});
        plain.kept.set('Night', {});
        // (the nested lists render apart from the menu, so the ids are compared as a set)
        expect((await open(plain).ids()).sort()).toEqual(['defaults', 'save', 'apply:Bars', 'apply:Night', 'remove:Bars', 'remove:Night', 'import', 'export'].sort());
        document.body.replaceChildren();
        const ordered = memoryStore(10, true);
        ordered.kept.set('Bars', {});
        ordered.kept.set('Night', {});
        const o = open(ordered);
        expect((await o.ids()).sort()).toEqual([
            'defaults', 'save', 'apply:Bars', 'apply:Night',
            'rename:Bars', 'up:Bars', 'down:Bars', 'remove:Bars',
            'rename:Night', 'up:Night', 'down:Night', 'remove:Night',
            'import', 'export',
        ].sort());
        // the first cannot move up, the last cannot move down
        const off = [...document.querySelectorAll<HTMLElement>('[role=menuitem][aria-disabled="true"]')].map((el) => el.dataset.value);
        expect(off).toEqual(['up:Bars', 'down:Night']);
    });

    it('removes the template picked under Manage', async () => {
        const store = memoryStore();
        store.kept.set('Bars', {});
        store.kept.set('Night', {});
        const o = open(store);
        await o.choose('manage', 'manage:Night', 'remove:Night');
        expect([...store.kept.keys()]).toEqual(['Bars']);
        expect(o.imported).toEqual([]);
    });

    it('renames through the footer\'s name field, and keeps it open on a taken name', async () => {
        const store = memoryStore(10, true);
        store.kept.set('Bars', { a: 1 });
        store.kept.set('Night', { b: 2 });
        const o = open(store);
        await o.choose('manage', 'manage:Night', 'rename:Night');
        const row = o.host.querySelector<HTMLElement>('.vela-sd-tpl-name')!;
        const name = row.querySelector<HTMLInputElement>('input')!;
        const submit = o.host.querySelector<HTMLButtonElement>('.vela-sd-tpl-save')!;
        expect([row.hidden, name.value, submit.textContent]).toEqual([false, 'Night', 'Rename']);
        name.value = 'Bars';
        submit.click();
        expect([...store.kept.keys()]).toEqual(['Bars', 'Night']);
        expect(row.hidden).toBe(false);
        name.value = 'Dusk';
        submit.click();
        expect([...store.kept]).toEqual([['Bars', { a: 1 }], ['Dusk', { b: 2 }]]);
        expect(row.hidden).toBe(true);
        // the field is Save as…'s again afterwards
        await o.pick('Save as…');
        expect([name.value, submit.textContent]).toEqual(['', 'Save']);
    });

    it('moves a template one place up or down', async () => {
        const store = memoryStore(10, true);
        for (const n of ['A', 'B', 'C']) store.kept.set(n, {});
        const o = open(store);
        await o.choose('manage', 'manage:A', 'down:A');
        expect([...store.kept.keys()]).toEqual(['B', 'A', 'C']);
        await o.choose('manage', 'manage:C', 'up:C');
        expect([...store.kept.keys()]).toEqual(['B', 'C', 'A']);
    });

    it('exports every template as one JSON document', async () => {
        const blobs: Blob[] = [];
        const create = URL.createObjectURL;
        const revoke = URL.revokeObjectURL;
        URL.createObjectURL = (blob: Blob) => { blobs.push(blob); return 'blob:test'; };
        URL.revokeObjectURL = () => {};
        try {
            const store = memoryStore();
            store.kept.set('Bars', { series: { style: 'bars' } });
            store.kept.set('Night', { layout: { background: '#000' } });
            await open(store).choose('export');
            expect(blobs).toHaveLength(1);
            expect(JSON.parse(await blobs[0]!.text())).toEqual({
                version: 1,
                settingsTemplates: [{ name: 'Bars', config: { series: { style: 'bars' } } }, { name: 'Night', config: { layout: { background: '#000' } } }],
            });
        } finally {
            URL.createObjectURL = create;
            URL.revokeObjectURL = revoke;
        }
    });

    it('imports a file of templates through the store, replacing one of the same name', async () => {
        const store = memoryStore();
        store.kept.set('Bars', { old: true });
        const o = open(store);
        const input = o.host.querySelector<HTMLInputElement>('.vela-sd-tpl-file')!;
        const file = new File([settingsTemplatesDocument({ ...memoryStore(), names: () => ['Bars', 'Dusk'], read: (n) => ({ from: n }) })], 'looks.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await tick();
        expect([...store.kept]).toEqual([['Bars', { from: 'Bars' }], ['Dusk', { from: 'Dusk' }]]);
        expect(await o.ids()).toContain('apply:Dusk');
    });
});

describe('a settings template file', () => {
    it('reads the exported document or a bare list, and leaves out what is not a template', () => {
        const entries = [{ name: ' Night ', config: { a: 1 } }, { name: '', config: {} }, { name: 'NoConfig' }, { name: 'List', config: [] }, null, 7];
        expect(parseSettingsTemplates(JSON.stringify({ version: 1, settingsTemplates: entries }))).toEqual([{ name: 'Night', config: { a: 1 } }]);
        expect(parseSettingsTemplates(JSON.stringify(entries))).toEqual([{ name: 'Night', config: { a: 1 } }]);
        expect(parseSettingsTemplates('not json')).toEqual([]);
        expect(parseSettingsTemplates('{"other":1}')).toEqual([]);
    });
});

describe('a renderer with a template store', () => {
    it('re-seeds the open dialog from an applied template', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const renderer = new NativeRenderer();
        renderer.mount(host, DARK_THEME);
        const store = memoryStore();
        store.kept.set('Wide', { series: { spacing: 4 } });
        renderer.setSettingsTemplates(store);
        renderer.openSettingsDialog();
        host.querySelector<HTMLButtonElement>('.vela-sd-tpl-btn')!.click();
        await tick();
        [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) => el.textContent === 'Wide')!.click();
        await tick();
        expect(renderer.getConfig().series.spacing).toBe(4);
        // the Spacing field of the dialog, still open, reads the template's value
        const spacing = [...host.querySelectorAll<HTMLElement>('.vela-field-row')].find((row) => row.textContent?.includes('Spacing'))!;
        expect(spacing.querySelector('input')!.value).toBe('4');
        renderer.destroy();
    });
});
