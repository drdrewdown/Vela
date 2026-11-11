// Settings templates as a file: the document the settings dialog's Template menu exports
// and reads back — `{ version, settingsTemplates: [{ name, config }] }`.
import type { SettingsTemplateStore } from '../../../core/options';

/** A template as a file carries it. */
export interface SettingsTemplateEntry {
    name: string;
    config: Record<string, unknown>;
}

/** Every template of a store as a JSON document, in the store's order. */
export function settingsTemplatesDocument(store: SettingsTemplateStore): string {
    const settingsTemplates = store
        .names()
        .map((name) => ({ name, config: store.read(name) }))
        .filter((t) => t.config != null && typeof t.config === 'object');
    return JSON.stringify({ version: 1, settingsTemplates }, null, 2);
}

/**
 * The templates a file holds: the document {@link settingsTemplatesDocument} writes, or a
 * bare list of entries. An entry needs a non-empty name and a config object; anything else
 * is left out. Text that is not JSON, or holds no list, gives none.
 */
export function parseSettingsTemplates(json: string): SettingsTemplateEntry[] {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    const list = Array.isArray(raw) ? raw : raw != null && typeof raw === 'object' ? (raw as { settingsTemplates?: unknown }).settingsTemplates : undefined;
    if (!Array.isArray(list)) return [];
    const out: SettingsTemplateEntry[] = [];
    for (const item of list as unknown[]) {
        if (item == null || typeof item !== 'object') continue;
        const t = item as { name?: unknown; config?: unknown };
        const name = typeof t.name === 'string' ? t.name.trim() : '';
        if (!name || t.config == null || typeof t.config !== 'object' || Array.isArray(t.config)) continue;
        out.push({ name, config: t.config as Record<string, unknown> });
    }
    return out;
}
