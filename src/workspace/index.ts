// vela/workspace — the multi-chart shell: a grid of ChartCells with stable identities,
// one shared data feed, an active cell, resizable splitters, and a layout registry
// (`registerLayout`) plugins extend like every other Vela registry.
export { VelaWorkspace } from './VelaWorkspace';
export type { VelaWorkspaceOptions, WorkspaceEventMap, WorkspaceScriptRun } from './VelaWorkspace';
export { ChartCell } from './ChartCell';
export type { CellSeed, CellBoot, CellChartDefaults, PooledCellState, CellNativeInfo } from './ChartCell';
export { ledgersEqual } from './indicator-templates';
export type { IndicatorTemplateApplyResult, IndicatorTemplateSaveResult } from './indicator-templates';
export type { WorkspaceWidgetContext } from './context';
export { WorkspaceReplay, barClose, lastOpenClosedBy } from './WorkspaceReplay';
export type { WorkspaceReplayEventMap, WorkspaceReplayStartOptions, WorkspaceReplayHost } from './WorkspaceReplay';
export {
    registerLayout,
    unregisterLayout,
    layoutDefinition,
    layouts,
    registerBuiltinLayouts,
    gridStyles,
    activeAfterLayout,
    layoutForGrid,
    ensureLayout,
    layoutShape,
    GRID_PICKER_MAX,
} from './layouts';
export type { LayoutDefinition, LayoutRegistration, LayoutShape, TrackSizes } from './layouts';
export { evenTracks, resizeTracks, trackOffsets } from './splitters';
export { syncTargets, rangesWithin } from './sync';
export type { SyncKind, SyncSetting, SyncOptions } from './sync';
export { encodeState, decodeState, sanitizeState, memoryStorageAdapter, MAX_INDICATOR_TEMPLATES } from './persist';
export type { WorkspaceState, CellState, ChartState, PanelsState, DrawingToolsState, IndicatorTemplate, WorkspaceStorage } from './persist';
