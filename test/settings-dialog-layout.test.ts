// @vitest-environment jsdom
// The chart settings dialog's layouts: `rail` (a tab rail and one column of rows) and
// `cards` (tabs across the top, each titled group of rows a card), chosen by the
// `settings.layout` policy.
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

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: SettingsDialog[] = [];
afterEach(() => {
    for (const dialog of live.splice(0)) dialog.destroy();
    document.body.replaceChildren();
});

function open(layout?: 'rail' | 'cards', mobile = false): { host: HTMLElement; dialog: SettingsDialog; patches: unknown[] } {
    const host = document.createElement('div');
    document.body.append(host);
    const dialog = new SettingsDialog(host, DARK_THEME);
    live.push(dialog);
    if (layout) dialog.setLayout(layout);
    if (mobile) dialog.setLayoutMode('mobile');
    const patches: unknown[] = [];
    dialog.open(new NativeRenderer().getConfig(), (patch) => patches.push(patch));
    return { host, dialog, patches };
}

const titles = (root: ParentNode) => [...root.querySelectorAll('.vela-field-section')].map((el) => el.textContent);

describe('the settings dialog layout', () => {
    it('keeps the rail and a single column of rows by default', () => {
        const { host } = open();
        expect(host.querySelector('.vela-sd-deck')).toBeNull();
        expect(host.querySelector('.vela-sd-card')).toBeNull();
        expect(host.querySelector('.vela-sd-btn-primary')).toBeNull();
    });

    it('puts every titled group of rows in a card of its own', () => {
        const { host } = open('cards');
        const cards = [...host.querySelectorAll<HTMLElement>('.vela-sd-deck > .vela-sd-card')];
        expect(cards.length).toBeGreaterThan(4);
        // One title per card, and it opens the card.
        for (const card of cards) {
            expect(titles(card)).toHaveLength(1);
            expect(card.querySelector('.vela-field-grid')!.firstElementChild!.classList.contains('vela-field-section')).toBe(true);
        }
        // No title is left outside a card.
        expect(titles(host)).toHaveLength(cards.length);
    });

    it('makes a price style\'s rows one card, hidden while another style is drawn', () => {
        const { host } = open('cards');
        const styleCards = [...host.querySelectorAll<HTMLElement>('.vela-sd-card[data-sd-group]')];
        const shown = styleCards.filter((card) => !card.classList.contains('vela-sd-hide'));
        expect(styleCards.length).toBeGreaterThan(1);
        expect(shown.map((card) => card.dataset.sdId)).toEqual(['symbol.style.candles']);
    });

    it('gives an on/off row a switch that emits the row\'s patch', () => {
        const { host, patches } = open('cards');
        const row = [...host.querySelectorAll<HTMLElement>('.vela-sd-card .vela-field-row')].find((el) => el.textContent?.includes('Animate zoom'))!;
        const input = row.querySelector<HTMLInputElement>('[data-slot~="switch"] input')!;
        input.click();
        expect(patches).toEqual([{ animations: { zoom: false } }]);
    });

    it('closes from the footer\'s Done button', () => {
        const { host, dialog } = open('cards');
        host.querySelector<HTMLButtonElement>('.vela-sd-btn-primary')!.click();
        expect(dialog.isOpen()).toBe(false);
    });

    it('rebuilds an open dialog when the layout changes', () => {
        const { host, dialog } = open();
        dialog.setLayout('cards');
        expect(dialog.isOpen()).toBe(true);
        expect(host.querySelector('.vela-sd-deck')).not.toBeNull();
    });

    it('leads each tab with its icon, and leaves a tab without one as its title alone', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const dialog = new SettingsDialog(host, DARK_THEME);
        live.push(dialog);
        dialog.setLayout('cards');
        dialog.setHostSections([
            { title: 'Status line', icon: 'type', rows: [{ kind: 'toggle', label: 'Symbol', get: () => true, set: () => {} }] },
            { title: 'Plain', rows: [{ kind: 'toggle', label: 'One', get: () => true, set: () => {} }] },
            { title: 'Unknown icon', icon: 'no-such-icon', rows: [{ kind: 'toggle', label: 'Two', get: () => true, set: () => {} }] },
        ]);
        dialog.open(new NativeRenderer().getConfig(), () => {});
        const icons = Object.fromEntries([...host.querySelectorAll<HTMLElement>('.vela-sd-tab')].map((tab) => [tab.textContent, tab.querySelector('.vela-sd-tab-icon svg') !== null]));
        expect(icons).toEqual({ 'Symbol': true, 'Status line': true, 'Plain': false, 'Unknown icon': false, 'Scales and lines': true, 'Canvas': true });
    });

    it('draws no tab icons on the rail', () => {
        const { host } = open();
        expect(host.querySelectorAll('.vela-sd-tab').length).toBeGreaterThan(2);
        expect(host.querySelector('.vela-sd-tab-icon')).toBeNull();
    });

    it('leaves the mobile presentation as it is', () => {
        const { host } = open('cards', true);
        expect(host.querySelector('.vela-sd-deck')).toBeNull();
        expect(host.querySelector('.vela-sd-btn-primary')).toBeNull();
    });
});
