// Settings templates — the workspace's saved chart looks (the settings dialog's Template menu).
import type { SettingsTemplate } from '../state/document';

/** A deep copy: a config document is plain JSON, and neither the list nor a caller may edit the other's. */
export function cloneSettingsTemplate(t: SettingsTemplate): SettingsTemplate {
    return { ...t, config: JSON.parse(JSON.stringify(t.config)) as Record<string, unknown> };
}
