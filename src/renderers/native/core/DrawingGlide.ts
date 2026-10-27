import type { DrawingBox, DrawingLabel, DrawingLine } from '../../../core/model/drawings';
import type { IndicatorModel } from '../../../core/model/indicator';
import { easeToward } from './Animator';

type Glidable = DrawingLine | DrawingBox | DrawingLabel;
type Kind = 'line' | 'box' | 'label';

interface Entry {
    /** The drawing as painted: a copy holding the eased prices while a glide is in flight. */
    shown: Glidable;
    kind: Kind;
    /** The prices the latest run asked for. */
    target: number[];
}

function pricesOf(kind: Kind, d: Glidable): number[] {
    if (kind === 'line') return [(d as DrawingLine).y1, (d as DrawingLine).y2];
    if (kind === 'box') return [(d as DrawingBox).top, (d as DrawingBox).bottom];
    return [(d as DrawingLabel).y];
}

function writePrices(kind: Kind, d: Glidable, v: readonly number[]): void {
    if (kind === 'line') {
        (d as DrawingLine).y1 = v[0]!;
        (d as DrawingLine).y2 = v[1]!;
    } else if (kind === 'box') {
        (d as DrawingBox).top = v[0]!;
        (d as DrawingBox).bottom = v[1]!;
    } else {
        (d as DrawingLabel).y = v[0]!;
    }
}

function settled(shown: readonly number[], target: readonly number[]): boolean {
    for (let i = 0; i < target.length; i++) {
        const eps = Math.max(1e-9, Math.abs(target[i]!) * 1e-6);
        if (!(Math.abs(shown[i]! - target[i]!) <= eps)) return false;
    }
    return true;
}

/**
 * Price glide for indicator drawings. A line, box or label emitted with `glide: true` keeps
 * its id from one run to the next; when a run moves its prices, the painted drawing eases
 * from where it is toward the new prices with the forming bar's time-constant
 * (`animations.liveBar`), the way the live candle does, instead of jumping. Everything else
 * about the drawing (its bar positions, colors, text) takes the new run's values at once.
 * A drawing seen for the first time snaps, and with the live-bar glide off every drawing
 * snaps and nothing animates.
 */
export class DrawingGlide {
    private readonly entries = new Map<string, Map<string, Entry>>();

    /**
     * Take a model's freshly patched drawings as the new targets. A glide drawing whose
     * prices moved is replaced in the model by a copy painted at its current eased prices.
     * Returns true when any glide is now in flight (the caller starts its animator).
     */
    retarget(model: IndicatorModel, tauMs: number): boolean {
        const prev = this.entries.get(model.id);
        const next = new Map<string, Entry>();
        let moving = false;
        const take = (kind: Kind, list: Glidable[] | undefined): void => {
            if (!list) return;
            for (let i = 0; i < list.length; i++) {
                const d = list[i]!;
                if (!d.glide) continue;
                const key = `${kind}|${d.id}`;
                const target = pricesOf(kind, d);
                const old = prev?.get(key);
                if (tauMs <= 0 || !old || settled(pricesOf(kind, old.shown), target)) {
                    next.set(key, { shown: d, kind, target });
                    continue;
                }
                const shown = { ...d } as Glidable;
                writePrices(kind, shown, pricesOf(kind, old.shown));
                list[i] = shown;
                next.set(key, { shown, kind, target });
                moving = true;
            }
        };
        take('line', model.lines);
        take('box', model.boxes);
        take('label', model.labels);
        if (next.size > 0) this.entries.set(model.id, next);
        else this.entries.delete(model.id);
        return moving;
    }

    /** Ease every in-flight drawing one frame toward its target. Returns true while any is moving. */
    step(dtMs: number, tauMs: number): boolean {
        let moving = false;
        for (const byId of this.entries.values()) {
            for (const e of byId.values()) {
                const shown = pricesOf(e.kind, e.shown);
                if (settled(shown, e.target)) continue;
                const eased = shown.map((v, i) => easeToward(v, e.target[i]!, dtMs, tauMs));
                const done = settled(eased, e.target);
                writePrices(e.kind, e.shown, done ? e.target : eased);
                if (!done) moving = true;
            }
        }
        return moving;
    }

    /** Forget an indicator's drawings (it was removed). */
    drop(modelId: string): void {
        this.entries.delete(modelId);
    }
}
