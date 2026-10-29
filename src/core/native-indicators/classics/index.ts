import type { MessageLike } from '../../i18n/types';
import { INDICATOR_CATEGORIES } from '../categories';
import { registerNativeIndicator } from '../NativeIndicator';
import { classicDescriptor } from './define';
import type { ClassicIndicatorSpec } from './define';
import { averageSpecs } from './averages';
import { bandSpecs } from './bands';
import { oscillatorSpecs } from './oscillators';
import { trendSpecs } from './trend';
import { volatilitySpecs } from './volatility';
import { volumeSpecs } from './volume';
import { overlaySpecs } from './overlays';

/**
 * The classic indicator catalog — the standard technical-analysis studies every
 * charting host expects (moving averages, oscillators, bands, volume studies),
 * each a pure compute over the chart's own bars riding the native-indicator
 * pipeline (picker, legend, panes, settings, persistence).
 */
export const classicSpecs: ClassicIndicatorSpec[] = [
    ...averageSpecs,
    ...bandSpecs,
    ...oscillatorSpecs,
    ...trendSpecs,
    ...volatilitySpecs,
    ...volumeSpecs,
    ...overlaySpecs,
];

/** Picker group per family — the catalog reads as a study library, not one long list. */
const FAMILY_CATEGORY: ReadonlyArray<readonly [ClassicIndicatorSpec[], MessageLike]> = [
    [averageSpecs, INDICATOR_CATEGORIES.movingAverages],
    [bandSpecs, INDICATOR_CATEGORIES.bands],
    [oscillatorSpecs, INDICATOR_CATEGORIES.oscillators],
    [trendSpecs, INDICATOR_CATEGORIES.trend],
    [volatilitySpecs, INDICATOR_CATEGORIES.volatility],
    [volumeSpecs, INDICATOR_CATEGORIES.volume],
    [overlaySpecs, INDICATOR_CATEGORIES.overlays],
];

export function classicCategory(spec: ClassicIndicatorSpec): MessageLike | undefined {
    return FAMILY_CATEGORY.find(([family]) => family.includes(spec))?.[1];
}

/** Register the classic indicator catalog (idempotent). Called by the composition root. */
export function registerClassicIndicators(): void {
    for (const spec of classicSpecs) {
        const category = classicCategory(spec);
        registerNativeIndicator(category ? { ...classicDescriptor(spec), category } : classicDescriptor(spec));
    }
}

export { classicDescriptor } from './define';
export type { ClassicIndicatorSpec, ClassicOutput, ClassicPlot, ClassicBand, ClassicLevel } from './define';
