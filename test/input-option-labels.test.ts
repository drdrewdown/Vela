import { describe, it, expect } from 'vitest';
import { optionPairs } from '../src/renderers/shared/IndicatorInputsDialog';

/**
 * A dropdown input may store identifiers and show names: `optionLabels` maps a stored value
 * to its display text. A host that binds a study to one of its saved objects (a signal spec,
 * a watchlist) keeps the id as the committed value — a rename never orphans the instance —
 * while the dialog reads as the object's name. An option without a label shows its value.
 */
describe('input option labels', () => {
    it('pairs every option value with its label, falling back to the value itself', () => {
        expect(optionPairs(['spec-1', 'spec-2', 'raw'], { 'spec-1': 'EMA cross', 'spec-2': 'AO hook' })).toEqual([
            { value: 'spec-1', label: 'EMA cross' },
            { value: 'spec-2', label: 'AO hook' },
            { value: 'raw', label: 'raw' },
        ]);
    });

    it('without a label map the label is the value', () => {
        expect(optionPairs(['a', 'b'], undefined)).toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }]);
    });
});
