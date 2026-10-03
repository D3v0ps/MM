"use client";
// Automatisk utkastsparning (D2 punkt 2, mb-vardag-7) – samma i appen och prototypen:
//   useAutosave({ enabled, dirty, changeKey, save }) sparar utkastet på servern 2 s efter senaste ändringen, vid
//   "lämna sidan" (vaktens trySave → flush) och när sidan döljs eller stängs (pagehide/visibilitychange, med keepalive).
//   Aldrig två sparningar samtidigt; en ändring under en pågående sparning ger en ny väntetid efteråt. "invalid" (formuläret
//   kan inte sparas automatiskt, t.ex. röd status utan avvikelse) stoppar tills nästa ändring. Skärmen visar läget med
//   <AutosaveStatus> (src/ui/autosave-status.tsx) – aldrig en toast per autosparning.
//   Revisionsloggen: servern loggar en rad per besök på sidan (editSession – newEditSession()), inte en per sparning.
// Logiken ligger i AutosaveController (utan React, testas med låtsasklocka); hooken kopplar den till skärmen. Väntetiden
// finns bara medan skärmen är kopplad (listen) – kopplas den loss och igen (React kör effekter två gånger i
// utvecklingsläget) startar den om, så att inget utkast förloras.
import { useEffect, useState } from "react";

export type AutosaveResult =
  | { ok: true; savedAt: string }
  | {
      ok: false;
      /** invalid = kan inte sparas förrän något är rättat (ingen ny väntetid förrän nästa ändring). failed = fel vid sparningen. */
      reason: "invalid" | "failed";
      /** Varför det inte sparas automatiskt (visas i statusraden). */
      text?: string;
    };
export type AutosaveState = "idle" | "saving" | "saved" | "invalid" | "failed";

export type AutosaveOptions = {
  /** Falskt för godkända formulär, under manuell sparning och efter att formuläret är klart. */
  enabled: boolean;
  /** Något är ändrat sedan senaste sparningen (skärmens baseline). */
  dirty: boolean;
  /** Ändras när innehållet ändras (t.ex. JSON av fälten): varje ändring startar om väntetiden. */
  changeKey: string;
  /** Väntetid efter senaste ändringen. Standard 2000 ms. */
  delayMs?: number;
  /** Spara utkastet (skärmens kommando med autosave: true). keepalive: sidan är på väg att stängas. */
  save: (opts: { keepalive: boolean }) => Promise<AutosaveResult>;
  /** Sparat tidigare i samma besök (utkastminnet): visas som "Utkast sparat …" tills nästa sparning. */
  initialSavedAt?: string | null;
};

export type AutosaveSnapshot = {
  state: AutosaveState;
  savedAt: string | null;
  /** Texten vid "invalid" (varför det inte sparas automatiskt), annars null. */
  invalidText: string | null;
};

export type Autosave = AutosaveSnapshot & {
  /** Spara genast om något är osparat. true = allt är sparat (inget osparat, eller sparningen lyckades). */
  flush: () => Promise<boolean>;
  /** Stoppa väntetiden och vänta in en pågående sparning – före en manuell sparning eller ett godkännande. */
  settle: () => Promise<void>;
  /** Skärmen sparade manuellt: visa "Utkast sparat …" med den tiden. */
  markSaved: (savedAt: string) => void;
};

export const AUTOSAVE_DELAY_MS = 2000;

/** Besöksnyckel för revisionsloggen: bara små bokstäver och siffror, 12–32 tecken (coach/api.ts editSession). */
export function newEditSession(): string {
  const raw = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^a-z0-9]/g, "").padEnd(12, "0").slice(0, 32);
}

/** Väntetid, pågående sparning och läge – utan React. */
export class AutosaveController {
  private opts: AutosaveOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<AutosaveResult> | null = null;
  /** Ändrat under en pågående sparning: ny väntetid när den är klar. */
  private again = false;
  /** changeKey vid senaste lyckade sparningen – så att flush() inte sparar samma innehåll igen. */
  private savedKey: string | null;
  private listener: ((s: AutosaveSnapshot) => void) | null = null;
  snapshot: AutosaveSnapshot;

  constructor(opts: AutosaveOptions) {
    this.opts = opts;
    this.savedKey = opts.initialSavedAt ? opts.changeKey : null;
    this.snapshot = { state: opts.initialSavedAt ? "saved" : "idle", savedAt: opts.initialSavedAt ?? null, invalidText: null };
  }

  /**
   * Koppla skärmen (null = koppla loss: väntetiden stoppas, inget läge skickas). React kan koppla loss och koppla igen utan
   * att skärmen försvinner (utvecklingslägets dubbla effekter) – därför startas väntetiden om när skärmen kopplas igen.
   */
  listen(fn: ((s: AutosaveSnapshot) => void) | null): void {
    this.listener = fn;
    if (fn) this.schedule();
    else this.clearTimer();
  }
  private set(patch: Partial<AutosaveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listener?.(this.snapshot);
  }

  /** Nya värden från skärmen (varje rendering). Väntetiden startas om bara när innehållet, enabled eller dirty ändrats. */
  update(opts: AutosaveOptions): void {
    const prev = this.opts;
    this.opts = opts;
    if (prev.enabled === opts.enabled && prev.dirty === opts.dirty && prev.changeKey === opts.changeKey && prev.delayMs === opts.delayMs) return;
    // Innehållet är tillbaka till det sparade (t.ex. den stoppande texten togs bort igen): "kan inte sparas" gäller inte längre.
    const s = this.snapshot.state;
    if ((s === "invalid" || s === "failed") && (opts.changeKey === this.savedKey || !opts.dirty)) this.set({ state: this.snapshot.savedAt ? "saved" : "idle", invalidText: null });
    this.schedule();
  }

  private unsaved(): boolean {
    const c = this.opts;
    return c.enabled && c.dirty && c.changeKey !== this.savedKey;
  }
  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  /** Ny väntetid från nu (om något är osparat). Ingen ny efter "invalid" förrän innehållet ändras – update() startar den då. */
  private schedule(): void {
    this.clearTimer();
    if (!this.listener || !this.unsaved()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.unsaved()) void this.run(false);
    }, this.opts.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  private async run(keepalive: boolean): Promise<AutosaveResult> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.clearTimer();
    const key = this.opts.changeKey;
    this.set({ state: "saving" });
    const p = this.opts.save({ keepalive }).catch((): AutosaveResult => ({ ok: false, reason: "failed" }));
    this.inflight = p;
    const res = await p;
    this.inflight = null;
    if (res.ok) {
      this.savedKey = key;
      this.set({ state: "saved", savedAt: res.savedAt, invalidText: null });
    } else {
      this.set({ state: res.reason, invalidText: res.reason === "invalid" ? (res.text ?? null) : null });
    }
    if (this.again) {
      // Ändrat medan det sparades: ny väntetid – om det fortfarande är osparat när den går ut.
      this.again = false;
      this.schedule();
    }
    return res;
  }

  /** Sidan döljs eller stängs: spara det osparade genast (appen: fetch med keepalive). */
  hide(): void {
    if (this.unsaved() && !this.inflight) void this.run(true);
  }

  flush = async (): Promise<boolean> => {
    if (this.inflight) await this.inflight;
    // Avstängd autosparning (t.ex. en godkänd kartläggning som ändras med "Spara ändringar"): det osparade kan inte sparas
    // här – vakten ska fråga. true bara när inget är ändrat.
    if (!this.opts.enabled) return !this.opts.dirty;
    if (!this.unsaved()) return true;
    return (await this.run(false)).ok;
  };

  settle = async (): Promise<void> => {
    this.clearTimer();
    this.again = false;
    if (this.inflight) await this.inflight;
  };

  markSaved = (savedAt: string): void => {
    this.savedKey = this.opts.changeKey;
    this.clearTimer();
    this.set({ state: "saved", savedAt, invalidText: null });
  };
}

export function useAutosave(o: AutosaveOptions): Autosave {
  const [ctl] = useState(() => new AutosaveController(o));
  const [snap, setSnap] = useState<AutosaveSnapshot>(ctl.snapshot);
  useEffect(() => {
    ctl.listen(setSnap);
    return () => ctl.listen(null);
  }, [ctl]);
  // Skärmens senaste värden – efter varje rendering (väntetiden startas om bara när något av dem ändrats).
  useEffect(() => {
    ctl.update(o);
  });
  useEffect(() => {
    const onHide = () => ctl.hide();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") ctl.hide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctl]);
  return { ...snap, flush: ctl.flush, settle: ctl.settle, markSaved: ctl.markSaved };
}
