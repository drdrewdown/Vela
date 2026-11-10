// Template dialog — "Save indicator template" (a name and what to remember with it) and
// "Rename template". The caller owns the rules: `onSubmit` says whether the name was taken
// (the dialog then shows why and stays open).
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageArgs, MessageLike, Translator } from '../core/i18n/types';
import { createButton, type ButtonHandle } from '@luxalgo/vela-ui/button';
import { Checkbox } from '@luxalgo/vela-ui/checkbox';
import { css } from '@luxalgo/vela-ui/css';
import { Dialog } from '@luxalgo/vela-ui/dialog';
import { Input } from '@luxalgo/vela-ui/input';
import { t } from '@luxalgo/vela-ui/t';
import { nextUid } from '@luxalgo/vela-ui/zag';
import { injectChromeStyles } from '../ui/chromeStyles';

const TEXT = {
    name: msg('widget.templateDialog.name', 'Template name'),
    cancel: msg('widget.templateDialog.cancel', 'Cancel'),
    saveTitle: msg('widget.templateDialog.saveTitle', 'Save indicator template'),
    renameTitle: msg('widget.templateDialog.renameTitle', 'Rename template'),
    save: msg('widget.templateDialog.save', 'Save'),
    rename: msg('widget.templateDialog.rename', 'Rename'),
    rememberInterval: msg('widget.templateDialog.rememberInterval', 'Remember interval'),
    rememberSymbol: msg('widget.templateDialog.rememberSymbol', 'Remember symbol'),
    noStudies: msg('widget.templateDialog.noStudies', 'No studies on this chart — the template clears a chart it is applied to.'),
    studies: msg('widget.templateDialog.studies', '{count, plural, one {# study} other {# studies}} on this chart.'),
    needsName: msg('widget.templateDialog.needsName', 'A template needs a name.'),
};

const STYLE_ID = 'vela-widget-template-dialog';
const CSS = css`@layer vela.chrome {

.vela-td { display: flex; flex-direction: column; gap: ${t.space[3]}; min-width: 320px; }
.vela-td-row { display: flex; align-items: center; justify-content: space-between; gap: ${t.space[3]}; color: ${t.fg}; font-size: 13px; }
.vela-td-row-hint { color: ${t.fg.muted}; font-size: 12px; }
.vela-td-note { color: ${t.fg.muted}; font-size: 12px; }
.vela-td-error { color: ${t.danger}; font-size: 12px; min-height: 1.2em; }

}`;

export interface TemplateDialogRequest {
    mode: 'save' | 'rename';
    /** The name to start from (a rename's current name; a preset being saved as the user's own). */
    name?: string;
    /** Save mode: the starting switch states and what they would remember. */
    rememberTimeframe?: boolean;
    rememberSymbol?: boolean;
    timeframeLabel?: string;
    symbol?: string;
    /** Save mode: how many studies the template would carry. */
    studies?: number;
    /** Commit; a string back is the reason the dialog stays open (shown under the field). */
    onSubmit: (name: string, remember: { timeframe: boolean; symbol: boolean }) => string | null;
}

export class TemplateDialog {
    private readonly dialog: Dialog;
    private readonly form: HTMLElement;
    private readonly name: Input;
    private readonly error: HTMLElement;
    private readonly submit: ButtonHandle;
    private req: TemplateDialogRequest | null = null;
    private remember = { timeframe: true, symbol: false };

    private readonly i18n: Translator | null;
    private readonly cancel: ButtonHandle;

    constructor(host: HTMLElement, i18n?: Translator) {
        this.i18n = i18n ?? null;
        const doc = host.ownerDocument;
        injectChromeStyles(STYLE_ID, CSS, doc);
        this.form = doc.createElement('div');
        this.form.className = 'vela-td';
        this.name = new Input({ fill: true });
        this.name.input.maxLength = 40;
        this.name.input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') this.commit();
            if (e.key === 'Escape') this.dialog.hide();
        });
        this.error = doc.createElement('div');
        this.error.className = 'vela-td-error';
        this.cancel = createButton({ text: this.t(TEXT.cancel), variant: 'outline', onClick: () => this.dialog.hide() });
        this.submit = createButton({ text: this.t(TEXT.save), onClick: () => this.commit() });
        this.dialog = new Dialog({
            title: this.t(TEXT.saveTitle),
            host,
            content: this.form,
            footer: (el) => el.append(this.cancel.el, this.submit.el),
            align: 'center',
            draggable: true,
            ...(i18n ? { i18n } : {}),
        });
    }

    open(req: TemplateDialogRequest): void {
        this.req = req;
        this.remember = { timeframe: req.rememberTimeframe ?? true, symbol: req.rememberSymbol ?? false };
        const doc = this.form.ownerDocument;
        this.form.replaceChildren();
        this.relocalize();
        this.name.input.value = req.name ?? '';
        this.form.appendChild(this.name.el);
        if (req.mode === 'save') {
            this.form.appendChild(this.switchRow(doc, this.t(TEXT.rememberInterval), req.timeframeLabel, this.remember.timeframe, (on) => (this.remember.timeframe = on)));
            this.form.appendChild(this.switchRow(doc, this.t(TEXT.rememberSymbol), req.symbol, this.remember.symbol, (on) => (this.remember.symbol = on)));
            if (req.studies !== undefined) {
                const note = doc.createElement('div');
                note.className = 'vela-td-note';
                note.textContent = req.studies === 0 ? this.t(TEXT.noStudies) : this.t(TEXT.studies, { count: req.studies });
                this.form.appendChild(note);
            }
        }
        this.error.textContent = '';
        this.form.appendChild(this.error);
        this.dialog.show();
        this.name.input.focus();
        this.name.input.select();
    }

    /** Re-read the title, the buttons and the name field in the current language. */
    relocalize(): void {
        const rename = this.req?.mode === 'rename';
        this.dialog.setI18n(this.i18n);
        this.dialog.titleEl.textContent = this.t(rename ? TEXT.renameTitle : TEXT.saveTitle);
        this.submit.setText(this.t(rename ? TEXT.rename : TEXT.save));
        this.cancel.setText(this.t(TEXT.cancel));
        this.name.input.placeholder = this.t(TEXT.name);
        this.name.input.setAttribute('aria-label', this.t(TEXT.name));
    }

    get open_(): boolean {
        return this.dialog.open;
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private t(m: MessageLike, values?: MessageArgs): string {
        return textOf(this.i18n, m, values);
    }

    private switchRow(doc: Document, label: string, hint: string | undefined, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
        const row = doc.createElement('div');
        row.className = 'vela-td-row';
        const id = nextUid('vela-td-remember');
        const text = doc.createElement('label');
        text.htmlFor = id;
        text.textContent = label;
        if (hint) {
            const h = doc.createElement('span');
            h.className = 'vela-td-row-hint';
            h.textContent = ` ${hint}`;
            text.appendChild(h);
        }
        const sw = new Checkbox({ id, defaultChecked: checked, size: 'sm', onCheckedChange: onChange });
        row.append(text, sw.el);
        return row;
    }

    private commit(): void {
        if (!this.req) return;
        const name = this.name.input.value.trim();
        if (!name) {
            this.error.textContent = this.t(TEXT.needsName);
            return;
        }
        const why = this.req.onSubmit(name, this.remember);
        if (why) {
            this.error.textContent = why;
            return;
        }
        this.dialog.hide();
    }
}
