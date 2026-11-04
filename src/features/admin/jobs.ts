// Bakgrundsjobbens läge i klartext (UX-genomgången, paket 1, A2) – ren logik utan I/O, samma på Underbiträden och integrationer
// och på systemadministratörens Min vecka. Ett jobb har ett läge, aldrig två samtidigt:
//   ok        Klar – senaste körningen gick bra
//   not_run   Inte körd än – jobbet är påslaget men har inte körts (t.ex. automatisk närvaro före första dagens slut)
//   waiting   Väntar – t.ex. veckorapporter som väntar på närvaro
//   disabled  Inte aktiverad – avstängt eller en regel som inte är fastställd
//   failed    Fel – senaste körningen misslyckades
// I prototypen märks jobb som hör till en senare utvecklingsfas (phase) bara "Byggs i fas N" – inte Klar samtidigt (BuildPhase
// visas bara i prototypen; i appen gäller jobbets eget läge).
import type { JobRow, JobStatusView } from "./api";

/** Läget som visas: i prototypen "phase" för jobb i en senare utvecklingsfas, annars jobbets läge. */
export type JobDisplayStatus = JobStatusView | "phase";
export function jobDisplayStatus(j: Pick<JobRow, "status" | "phase">, demo: boolean): JobDisplayStatus {
  return demo && j.phase ? "phase" : j.status;
}

/** Jobben som går som de ska (Klar) och de som avviker (allt annat), i samma ordning som listan: fel först. */
export function jobHealth<T extends Pick<JobRow, "status" | "phase">>(jobs: readonly T[], demo: boolean): { ok: T[]; deviating: T[] } {
  const order: Record<JobDisplayStatus, number> = { failed: 0, waiting: 1, not_run: 2, disabled: 3, phase: 4, ok: 5 };
  const ok = jobs.filter((j) => jobDisplayStatus(j, demo) === "ok");
  const deviating = jobs
    .map((j, i) => ({ j, i }))
    .filter((x) => jobDisplayStatus(x.j, demo) !== "ok")
    .sort((a, b) => order[jobDisplayStatus(a.j, demo)] - order[jobDisplayStatus(b.j, demo)] || a.i - b.i)
    .map((x) => x.j);
  return { ok, deviating };
}
