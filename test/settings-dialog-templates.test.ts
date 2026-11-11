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

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: SettingsDialog[] = [];
afterEach(() => {
    for (const dialog of live.splice(0)) dialog.destroy();
    document.body.replaceChildren();
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** A store over a plain map, refusing a new name past `cap`. */
function memoryStore(cap = 10): SettingsTemplateStore & { kept: Map<string, unknown> } {
    const kept = new Map<string, unknown>();
    return {
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
        expect(await o.rows()).toEqual(['Apply defaults', 'Save as…', 'No saved templates yet']);
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

    it('lists the saved templates under a Remove branch, and drops the one picked there', async () => {
        const store = memoryStore();
        store.kept.set('Bars', {});
        store.kept.set('Night', {});
        const o = open(store);
        // each name twice: its own row (a click applies) and again in the Remove branch's list
        expect(await o.rows()).toEqual(['Apply defaults', 'Save as…', 'Bars', 'Night', 'Remove', 'Bars', 'Night']);
        // the branch opens its list, and the name picked THERE is removed
        [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) => el.textContent === 'Remove')!.click();
        await tick();
        const inBranch = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].filter((el) => el.textContent === 'Night');
        inBranch[inBranch.length - 1]!.click();
        await tick();
        expect([...store.kept.keys()]).toEqual(['Bars']);
        expect(o.imported).toEqual([]);
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
