// @vitest-environment jsdom
// Where the chart settings dialog opens (`settings.placement`): near the top of its host,
// centred in it, or centred on the viewport as far as its host allows.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
/** Every live observer's callback, so a test can report a host resize. */
const hostObservers = new Set<() => void>();
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(private readonly cb: () => void) {}
    observe() { hostObservers.add(this.cb); }
    unobserve() {}
    disconnect() { hostObservers.delete(this.cb); }
};

import { SettingsDialog } from '../src/renderers/native/chrome/SettingsDialog';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { PLACEMENT_MARGIN, viewportOffset } from '../src/renderers/native/chrome/settings-placement';
import { DARK_THEME } from '../src/core/theme';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const VIEWPORT = { width: 1920, height: 1080 };
/** A chart area beside a 340px side panel, under a 50px header. */
const HOST = { left: 0, top: 50, width: 1580, height: 1030 };
const PANEL = { width: 1040, height: 650 };

describe('viewportOffset', () => {
    it('is the way from the host\'s centre to the viewport\'s', () => {
        // host centre (790, 565), viewport centre (960, 540)
        expect(viewportOffset(HOST, PANEL, VIEWPORT)).toEqual({ x: 170, y: -25 });
        expect(viewportOffset({ left: 0, top: 0, ...VIEWPORT }, PANEL, VIEWPORT)).toEqual({ x: 0, y: 0 });
    });

    it('stops where the dialog would leave its host, a margin short of the edge', () => {
        const narrow = { ...HOST, width: 1200 }; // 80px a side to spare
        expect(viewportOffset(narrow, PANEL, VIEWPORT).x).toBe(80 - PLACEMENT_MARGIN);
        const rightOfPanel = { ...narrow, left: 720 }; // the viewport's centre lies to the host's left
        expect(viewportOffset(rightOfPanel, PANEL, VIEWPORT).x).toBe(-(80 - PLACEMENT_MARGIN));
    });

    it('is none on an axis the dialog does not fit', () => {
        expect(viewportOffset({ ...HOST, width: 900, height: 600 }, PANEL, VIEWPORT)).toEqual({ x: 0, y: 0 });
    });
});

describe('the settings dialog placement', () => {
    const live: SettingsDialog[] = [];
    const rect = Element.prototype.getBoundingClientRect;
    const size = { width: window.innerWidth, height: window.innerHeight };
    let host = HOST;

    function setViewport(width: number, height: number): void {
        Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    }

    /** jsdom lays nothing out: the host and the dialog panel answer with the sizes under test. */
    function stubLayout(): void {
        Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
            const box = this.classList.contains('host-under-test') ? host : this.classList.contains('vela-dialog') ? { left: 0, top: 0, ...PANEL } : null;
            if (!box) return rect.call(this);
            return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box } as DOMRect;
        };
    }

    afterEach(() => {
        for (const dialog of live.splice(0)) dialog.destroy();
        Element.prototype.getBoundingClientRect = rect;
        setViewport(size.width, size.height);
        host = HOST;
        document.body.replaceChildren();
    });

    function open(placement?: 'top' | 'center' | 'viewport', mobile = false): { positioner: HTMLElement; dialog: SettingsDialog } {
        stubLayout();
        setViewport(VIEWPORT.width, VIEWPORT.height);
        const el = document.createElement('div');
        el.className = 'host-under-test';
        document.body.append(el);
        const dialog = new SettingsDialog(el, DARK_THEME);
        live.push(dialog);
        if (placement) dialog.setPlacement(placement);
        if (mobile) dialog.setLayoutMode('mobile');
        dialog.open(new NativeRenderer().getConfig(), () => {});
        return { positioner: el.querySelector<HTMLElement>('[data-slot~="dialog-positioner"]')!, dialog };
    }

    const padding = (el: HTMLElement): string[] => [el.style.paddingTop, el.style.paddingRight, el.style.paddingBottom, el.style.paddingLeft];

    it('opens near the top of its host by default', () => {
        const { positioner } = open();
        expect(positioner.dataset.align).toBe('top');
        expect(positioner.style.paddingTop).toBe('8vh');
    });

    it('centres in its host under `center`', () => {
        const { positioner } = open('center');
        expect(positioner.dataset.align).toBe('center');
        expect(padding(positioner)).toEqual(['', '', '', '']);
    });

    it('centres on the viewport under `viewport`, by padding the side it moves away from', () => {
        const { positioner } = open('viewport');
        expect(positioner.dataset.align).toBe('center');
        // 170 right and 25 up of the host's centre: twice that, on the left and at the bottom
        expect(padding(positioner)).toEqual(['0px', '0px', '50px', '340px']);
    });

    it('follows the window as it is resized, until the dialog closes', () => {
        const { positioner, dialog } = open('viewport');
        setViewport(1700, 1080); // centre x 850: 60 right of the host's
        window.dispatchEvent(new Event('resize'));
        expect(positioner.style.paddingLeft).toBe('120px');
        dialog.close();
        setViewport(1920, 1080);
        window.dispatchEvent(new Event('resize'));
        expect(positioner.style.paddingLeft).toBe('120px');
    });

    it('follows its host when the host alone changes size', () => {
        const { positioner, dialog } = open('viewport');
        host = { ...HOST, width: 1880 }; // a side panel folded away: the host's centre is 940, the viewport's 960
        for (const report of [...hostObservers]) report();
        expect(positioner.style.paddingLeft).toBe('40px');
        dialog.close();
        expect(hostObservers.size).toBe(0);
    });

    it('measures the dialog unshifted, so an earlier offset never narrows it', () => {
        const { positioner } = open('viewport');
        const seen: string[] = [];
        const measure = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
            if (this.classList.contains('vela-dialog')) seen.push(positioner.style.paddingLeft);
            return measure.call(this);
        };
        window.dispatchEvent(new Event('resize'));
        expect(seen).toEqual(['0px']);
        expect(positioner.style.paddingLeft).toBe('340px');
    });

    it('re-places an open dialog when the placement changes', () => {
        const { dialog } = open();
        dialog.setPlacement('viewport');
        const positioner = document.querySelector<HTMLElement>('[data-slot~="dialog-positioner"]')!;
        expect(positioner.dataset.align).toBe('center');
        expect(positioner.style.paddingLeft).toBe('340px');
    });

    it('leaves the mobile presentation filling its host', () => {
        const { positioner } = open('viewport', true);
        expect(positioner.style.paddingTop).toBe('0px');
        expect(positioner.style.paddingLeft).toBe('');
    });
});
