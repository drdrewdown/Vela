// Indicator templates — the pure half: the list's rules (names, the cap, saves over an
// existing name) and the ledger comparison an "active template" read is built on. The
// workspace wires these to its cells, its events and its persisted document.
import { MAX_INDICATOR_TEMPLATES, type IndicatorTemplate, type PersistedManifestEntry, type PersistedNativeEntry } from '../state/document';
import type { IndicatorLedger } from '../widget/indicators';

/** A ledger either way it travels: live (typed values) or persisted (plain bags). */
type AnyLedger = IndicatorLedger | IndicatorTemplate['indicators'];

export type IndicatorTemplateSaveResult =
    | { ok: true; template: IndicatorTemplate; replaced: boolean }
    | { ok: false; reason: 'empty-name' | 'full' | 'no-cell' };

export type IndicatorTemplateApplyResult =
    | { ok: true; cells: string[]; skipped: string[] }
    | { ok: false; reason: 'unknown' | 'no-cell' };

/** Names are unique case-insensitively, whitespace trimmed. */
export function sameTemplateName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findTemplate(list: readonly IndicatorTemplate[], name: string): IndicatorTemplate | undefined {
    return list.find((t) => sameTemplateName(t.name, name));
}

/** A deep copy — the store hands out copies so a caller's edits never reach the document. */
export function cloneTemplate(t: IndicatorTemplate): IndicatorTemplate {
    return JSON.parse(JSON.stringify(t)) as IndicatorTemplate;
}

/** One entry in a canonical string: a bare name/type and its object form with no deltas read
 *  the same, keys sort, a `hidden: false` drops. */
function canonicalNative(e: PersistedNativeEntry): string {
    const o = typeof e === 'string' ? { type: e } : { type: e.type, ...(e.inputs && Object.keys(e.inputs).length > 0 ? { inputs: e.inputs } : {}), ...(e.hidden ? { hidden: true } : {}) };
    return stableJson(o);
}

function canonicalManifest(e: PersistedManifestEntry): string {
    const o =
        typeof e === 'string'
            ? { name: e }
            : {
                  name: e.name,
                  ...(e.inputs && Object.keys(e.inputs).length > 0 ? { inputs: e.inputs } : {}),
                  ...(e.props && Object.keys(e.props).length > 0 ? { props: e.props } : {}),
                  ...(e.hidden ? { hidden: true } : {}),
              };
    return stableJson(o);
}

function stableJson(v: unknown): string {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(v);
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableJson(o[k])).join(',') + '}';
}

/** Two ledgers describe the same indicator set: the same multiset of native entries and of
 *  manifest entries, settings and visibility included, order on the chart ignored. */
export function ledgersEqual(a: AnyLedger, b: AnyLedger): boolean {
    const nat = (l: AnyLedger) => (l.natives as readonly PersistedNativeEntry[]).map(canonicalNative).sort().join('\n');
    const man = (l: AnyLedger) => (l.manifest as readonly PersistedManifestEntry[]).map(canonicalManifest).sort().join('\n');
    return nat(a) === nat(b) && man(a) === man(b);
}

/** Save a template: an existing name (case-insensitive) is updated in place and keeps its
 *  position and `createdAt`; a new name joins at the end while the list is under the cap. */
export function upsertTemplate(
    list: readonly IndicatorTemplate[],
    draft: Omit<IndicatorTemplate, 'createdAt' | 'updatedAt'>,
    now: number,
): { list: IndicatorTemplate[]; result: IndicatorTemplateSaveResult } {
    const name = draft.name.trim();
    if (!name) return { list: [...list], result: { ok: false, reason: 'empty-name' } };
    const idx = list.findIndex((t) => sameTemplateName(t.name, name));
    if (idx >= 0) {
        const prev = list[idx]!;
        const template: IndicatorTemplate = { ...draft, name, createdAt: prev.createdAt, updatedAt: now };
        const next = [...list];
        next[idx] = template;
        return { list: next, result: { ok: true, template, replaced: true } };
    }
    if (list.length >= MAX_INDICATOR_TEMPLATES) return { list: [...list], result: { ok: false, reason: 'full' } };
    const template: IndicatorTemplate = { ...draft, name, createdAt: now, updatedAt: now };
    return { list: [...list, template], result: { ok: true, template, replaced: false } };
}

/** Rename in place; null when `from` is missing, `to` is empty, or `to` names another entry. */
export function renameTemplate(list: readonly IndicatorTemplate[], from: string, to: string): IndicatorTemplate[] | null {
    const name = to.trim();
    const idx = list.findIndex((t) => sameTemplateName(t.name, from));
    if (idx < 0 || !name) return null;
    if (list.some((t, i) => i !== idx && sameTemplateName(t.name, name))) return null;
    const next = [...list];
    next[idx] = { ...list[idx]!, name };
    return next;
}

/** Remove by name; null when nothing carried it. */
export function removeTemplate(list: readonly IndicatorTemplate[], name: string): IndicatorTemplate[] | null {
    const idx = list.findIndex((t) => sameTemplateName(t.name, name));
    if (idx < 0) return null;
    return list.filter((_, i) => i !== idx);
}
