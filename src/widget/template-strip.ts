// Template strip — the bottom bar's middle: one chip per saved indicator template (click
// applies, right-click manages), the host's read-only presets after a divider, and a `+`
// that saves the active chart's set. The chip whose set the active chart shows is
// highlighted; a chart that drifted from the template it last applied shows a dot.
import { Menu } from '../ui/components/menu';
import { injectStyles } from '../ui/styles';
import { TemplateDialog } from './template-dialog';
import { timeframeLabel } from './timeframe';

const STYLE_ID = 'vela-widget-template-strip';
const CSS = `
.vela-bb-templates { display: inline-flex; align-items: center; gap: 2px; min-width: 0; overflow: hidden; }
.vela-bb-template {
    all: unset;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border-radius: 4px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    color: var(--vela-fg-muted);
}
.vela-bb-template:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-template[data-active='1'] { color: var(--vela-fg-bright); background: var(--vela-hover); box-shadow: inset 0 0 0 1px var(--vela-border-strong); }
.vela-bb-template[data-drifted='1']::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--vela-accent); }
.vela-bb-template-tf { font-size: 10px; font-weight: 500; opacity: 0.8; }
.vela-bb-template[data-builtin='1'] { font-weight: 500; }
.vela-bb-template-sep { width: 1px; height: 16px; margin: 0 4px; background: var(--vela-border-strong); }
.vela-bb-template-add {
    all: unset;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    color: var(--vela-fg-muted);
}
.vela-bb-template-add:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-template-add:disabled { cursor: not-allowed; opacity: 0.45; }
`;

/** The most characters a chip shows of a name; the rest is the tooltip's. */
const CHIP_CHARS = 14;

export interface TemplateChipRow {
    name: string;
    builtIn: boolean;
    timeframe?: string;
    symbol?: string;
    /** The studies' titles, for the chip's tooltip. */
    studies: readonly string[];
    /** `exact`: the active chart shows this set; `drifted`: it last applied this one and has since changed. */
    state: 'exact' | 'drifted' | null;
}

export interface TemplateStripOptions {
    /** Where the menu and the dialog portal to. */
    host: HTMLElement;
    rows: () => readonly TemplateChipRow[];
    /** The active chart's market and study count, for the save dialog. */
    context: () => { timeframe: string; symbol: string; studies: number };
    canSave: () => boolean;
    /** Apply a template to the active chart, or to every chart with the modifier held. */
    onApply: (name: string, allCells: boolean) => void;
    /** Save the active chart's set; a string back is why it was refused. */
    onSave: (name: string, remember: { timeframe: boolean; symbol: boolean }) => string | null;
    /** Overwrite a saved template with the active chart's set (its remembered interval/symbol kept). */
    onUpdate: (name: string) => void;
    /** A string back is why the rename was refused. */
    onRename: (from: string, to: string) => string | null;
    onRemove: (name: string) => void;
    /** Flip whether a saved template remembers its interval or its symbol. */
    onToggleMemory: (name: string, key: 'timeframe' | 'symbol') => void;
    /** How a remembered interval reads on a chip (default: Vela's grammar). */
    timeframeLabel?: (timeframe: string) => string;
    /** A saved chip dropped onto another: move it to that position. */
    onMove?: (name: string, toIndex: number) => void;
    /** The saved templates as a JSON document, for the `+` chip's Export. */
    onExport?: () => string;
    /** A JSON document the user picked for the `+` chip's Import. */
    onImport?: (json: string) => void;
}

/** A chip's visible label: the name cut to {@link CHIP_CHARS} with an ellipsis. */
export function chipLabel(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > CHIP_CHARS ? `${trimmed.slice(0, CHIP_CHARS - 1).trimEnd()}…` : trimmed;
}

/** A chip's tooltip: the studies, then what the template remembers. */
export function chipTooltip(row: TemplateChipRow, label: (timeframe: string) => string = timeframeLabel): string {
    const lines = [row.name, row.studies.length > 0 ? row.studies.join(', ') : 'No studies (clears the chart)'];
    const remembers: string[] = [];
    if (row.timeframe) remembers.push(`interval ${label(row.timeframe)}`);
    if (row.symbol) remembers.push(`symbol ${row.symbol}`);
    if (remembers.length > 0) lines.push(`Remembers ${remembers.join(' and ')}`);
    if (row.builtIn) lines.push('Built-in — right-click to save as your own');
    return lines.join('\n');
}

/** The `+` chip's right-click menu: the whole list in and out as a file. */
export function addMenuRows(hasTemplates: boolean): Array<{ id: string; label: string; disabled?: boolean }> {
    return [
        { id: 'export', label: 'Export templates…', disabled: !hasTemplates },
        { id: 'import', label: 'Import templates…' },
    ];
}

/** Hand the browser a text file to save. */
function downloadText(doc: Document, text: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The right-click menu of a chip, by the chip's kind. */
export function templateMenuRows(row: TemplateChipRow): Array<{ id: string; label: string; checked?: boolean; toggle?: boolean; separatorBefore?: boolean }> {
    if (row.builtIn) return [{ id: 'copy', label: 'Save as my template…' }];
    return [
        { id: 'update', label: 'Update from chart' },
        { id: 'rename', label: 'Rename…' },
        { id: 'timeframe', label: 'Remember interval', checked: Boolean(row.timeframe), toggle: true, separatorBefore: true },
        { id: 'symbol', label: 'Remember symbol', checked: Boolean(row.symbol), toggle: true },
        { id: 'remove', label: 'Remove', separatorBefore: true },
    ];
}

export class TemplateStrip {
    readonly el: HTMLElement;
    private readonly opts: TemplateStripOptions;
    private readonly menu: Menu;
    private readonly dialog: TemplateDialog;
    private readonly add: HTMLButtonElement;
    private readonly addMenu: Menu;
    private readonly fileInput: HTMLInputElement;
    private menuRow: TemplateChipRow | null = null;
    private dragName: string | null = null;

    constructor(opts: TemplateStripOptions) {
        this.opts = opts;
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-bb-templates';
        this.el.setAttribute('role', 'group');
        this.el.setAttribute('aria-label', 'Indicator templates');
        this.add = doc.createElement('button');
        this.add.className = 'vela-bb-template-add';
        this.add.textContent = '+';
        this.add.setAttribute('aria-label', 'Save indicator template');
        this.add.addEventListener('click', () => this.openSave());
        this.add.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.addMenu.setItems(addMenuRows(this.opts.rows().some((r) => !r.builtIn)));
            this.addMenu.openAt(e.clientX, e.clientY);
        });
        this.addMenu = new Menu({ host: opts.host, items: [], placement: 'top-start', onSelect: (id) => this.runAdd(id) });
        this.fileInput = doc.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.json,application/json';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            this.fileInput.value = '';
            if (!file) return;
            void file.text().then((text) => this.opts.onImport?.(text));
        });
        opts.host.appendChild(this.fileInput);
        this.menu = new Menu({ host: opts.host, items: [], placement: 'top-start', checkmarks: true, onSelect: (id) => this.run(id) });
        this.dialog = new TemplateDialog(opts.host);
        this.refresh();
    }

    /** Rebuild the chips from the host's rows (cheap: a handful of buttons). */
    refresh(): void {
        const doc = this.el.ownerDocument;
        const rows = this.opts.rows();
        this.el.replaceChildren();
        let dividerDue = false;
        for (const row of rows) {
            if (row.builtIn && !dividerDue && this.el.childElementCount > 0) {
                const sep = doc.createElement('span');
                sep.className = 'vela-bb-template-sep';
                this.el.appendChild(sep);
            }
            if (row.builtIn) dividerDue = true;
            this.el.appendChild(this.chip(doc, row));
        }
        const full = !this.opts.canSave();
        this.add.disabled = full;
        this.add.title = full ? 'Ten templates already — update or remove one' : 'Save the current indicators as a template';
        this.el.appendChild(this.add);
    }

    destroy(): void {
        this.menu.destroy();
        this.addMenu.destroy();
        this.dialog.destroy();
        this.fileInput.remove();
        this.el.remove();
    }

    /** Import a JSON document directly (the file picker's path, and a test's). */
    importText(text: string): void {
        this.opts.onImport?.(text);
    }

    private chip(doc: Document, row: TemplateChipRow): HTMLButtonElement {
        const b = doc.createElement('button');
        b.className = 'vela-bb-template';
        b.dataset.name = row.name;
        if (row.builtIn) b.dataset.builtin = '1';
        if (row.state === 'exact') b.dataset.active = '1';
        if (row.state === 'drifted') b.dataset.drifted = '1';
        const label = this.opts.timeframeLabel ?? timeframeLabel;
        b.title = chipTooltip(row, label);
        b.textContent = chipLabel(row.name);
        if (row.timeframe) {
            const tf = doc.createElement('span');
            tf.className = 'vela-bb-template-tf';
            tf.textContent = label(row.timeframe);
            b.appendChild(tf);
        }
        b.addEventListener('click', (e) => this.opts.onApply(row.name, e.altKey || e.metaKey));
        if (!row.builtIn && this.opts.onMove) {
            // Drag a saved chip onto another saved chip to move it there; the order is the document's.
            b.draggable = true;
            b.addEventListener('dragstart', () => {
                this.dragName = row.name;
            });
            b.addEventListener('dragover', (e) => {
                if (this.dragName && this.dragName !== row.name) e.preventDefault();
            });
            b.addEventListener('drop', (e) => {
                e.preventDefault();
                const from = this.dragName;
                this.dragName = null;
                if (!from || from === row.name) return;
                const saved = this.opts.rows().filter((r) => !r.builtIn).map((r) => r.name);
                this.opts.onMove?.(from, saved.indexOf(row.name));
            });
            b.addEventListener('dragend', () => {
                this.dragName = null;
            });
        }
        b.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.menuRow = row;
            this.menu.setItems(templateMenuRows(row));
            this.menu.openAt(e.clientX, e.clientY);
        });
        return b;
    }

    private openSave(name?: string): void {
        const ctx = this.opts.context();
        this.dialog.open({
            mode: 'save',
            name,
            timeframeLabel: (this.opts.timeframeLabel ?? timeframeLabel)(ctx.timeframe),
            symbol: ctx.symbol,
            studies: ctx.studies,
            onSubmit: (n, remember) => this.opts.onSave(n, remember),
        });
    }

    private runAdd(id: string): void {
        if (id === 'export') {
            const text = this.opts.onExport?.();
            if (text) downloadText(this.el.ownerDocument, text, 'indicator-templates.json');
        } else if (id === 'import') this.fileInput.click();
    }

    private run(id: string): void {
        const row = this.menuRow;
        if (!row) return;
        switch (id) {
            case 'copy':
                this.openSave(row.name);
                break;
            case 'update':
                this.opts.onUpdate(row.name);
                break;
            case 'rename':
                this.dialog.open({ mode: 'rename', name: row.name, onSubmit: (n) => this.opts.onRename(row.name, n) });
                break;
            case 'timeframe':
            case 'symbol':
                this.opts.onToggleMemory(row.name, id);
                break;
            case 'remove':
                this.opts.onRemove(row.name);
                break;
        }
    }
}
