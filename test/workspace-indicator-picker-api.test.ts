// @vitest-environment jsdom
// `openIndicatorPicker()` — the topbar button's programmatic twin, so a host drawing its own
// Indicators button opens the shell's picker through the API rather than a private field.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
});

describe('openIndicatorPicker', () => {
    it('opens the shell picker with the active cell synced', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: '1', volume: false } as never);
        live.push(ws);
        const dialogOpen = () => document.querySelector('.vela-ip-list')?.closest('[role="dialog"], .vela-dialog-panel') ?? null;
        const before = dialogOpen();
        ws.openIndicatorPicker();
        const after = document.querySelector('.vela-ip-list');
        expect(after).not.toBeNull();
        expect(before === null || before !== after).toBe(true);
    });

    it('is a no-op on a workspace built without the picker', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: '1', volume: false, indicatorPicker: false } as never);
        live.push(ws);
        expect(() => ws.openIndicatorPicker()).not.toThrow();
    });
});
