// Where the settings dialog sits in its host when it is asked to centre on the viewport.

/** A rectangle's edges and size in viewport pixels (a `DOMRect`, or any part of one). */
export interface PlacementRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The gap kept between the dialog and its host's edges. */
export const PLACEMENT_MARGIN = 8;

/**
 * How far from its host's centre a dialog must sit to be centred on the viewport — and no
 * further than keeps it inside the host, {@link PLACEMENT_MARGIN} clear of its edges. A host
 * that is the whole viewport gives no offset; a host too small for the dialog gives none on
 * that axis either (it stays centred in the host).
 */
export function viewportOffset(host: PlacementRect, panel: { width: number; height: number }, viewport: { width: number; height: number }): { x: number; y: number } {
    const along = (hostStart: number, hostSize: number, panelSize: number, viewportSize: number): number => {
        const room = Math.max(0, (hostSize - panelSize) / 2 - PLACEMENT_MARGIN);
        const wanted = viewportSize / 2 - (hostStart + hostSize / 2);
        return Math.round(Math.max(-room, Math.min(room, wanted)));
    };
    return { x: along(host.left, host.width, panel.width, viewport.width), y: along(host.top, host.height, panel.height, viewport.height) };
}
