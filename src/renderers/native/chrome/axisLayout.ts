/**
 * Right-gutter column geometry, shared by the renderer (which reserves the gutter and
 * routes input) and the chrome layer (which draws the tick labels). The gutter holds the
 * pane's master price scale in the leftmost column (nearest the data), and one extra
 * column per merged (own-scale) indicator to its right.
 */
export const AXIS_MASTER_W = 64; // px — the pane master-scale column (nearest the data)
export const AXIS_MERGED_W = 56; // px — each additional merged-indicator scale column

/** Thickness of the horizontal separator drawn at each stacked pane's top edge (data + gutter). */
export const PANE_SEPARATOR_PX = 3;

/** Total right-gutter width for a given number of merged scale columns. */
export function axisGutterWidth(mergedColumns: number): number {
    return AXIS_MASTER_W + AXIS_MERGED_W * Math.max(0, mergedColumns);
}

/** Left x (relative to the data area's right edge `dataW`) of a scale column.
 *  Column 0 is the master scale; columns ≥ 1 are merged-indicator scales. */
export function axisColumnX(dataW: number, column: number): number {
    return column === 0 ? dataW : dataW + AXIS_MASTER_W + (column - 1) * AXIS_MERGED_W;
}

/** Width of a scale column (master vs merged). */
export function axisColumnWidth(column: number): number {
    return column === 0 ? AXIS_MASTER_W : AXIS_MERGED_W;
}

/**
 * The width of the gutter to the RIGHT of a pane's data area. With the price scale docked
 * right it is the axis column; docked left the axis becomes a left gutter and nothing sits
 * to the right — a control pinned "just left of the axis" must then pin to the plot's edge.
 */
export function rightGutterPx(scaleSide: 'left' | 'right', rightAxisW: number): number {
    return scaleSide === 'left' ? 0 : rightAxisW;
}

/**
 * Left x, within the plot, of a pane's MASTER scale column — the column nearest the data,
 * on whichever side the scale docks. Docked right it starts where the data area ends;
 * docked left it is the innermost `AXIS_MASTER_W` of the left gutter (merged columns sit
 * further out). Anything that lives on the master column — the auto/log buttons — reads this
 * rather than assuming the right edge.
 */
export function masterColumnX(scaleSide: 'left' | 'right', axisW: number, plotW: number): number {
    return scaleColumnX(scaleSide, axisW, plotW, 0);
}

/**
 * Left x, within the plot, of any scale column on whichever side the scale docks: column 0
 * is the master scale (see {@link masterColumnX}); columns ≥ 1 are the merged-indicator
 * scales, each one further OUT from the data — rightward docked right, leftward docked left.
 */
export function scaleColumnX(scaleSide: 'left' | 'right', axisW: number, plotW: number, column: number): number {
    if (scaleSide === 'left') return axisW - AXIS_MASTER_W - column * AXIS_MERGED_W;
    return axisColumnX(plotW - axisW, column);
}
