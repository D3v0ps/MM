"use client";
// PLATSHÅLLARE – prototypfältet (perspektiv, roll, demodatum, scenarier, feedback, återställ).
import type { Persona } from "@/data/actors";
import { useSession } from "@/shell/session";

export function PrototypeChrome({ personas, onReset }: { personas: Persona[]; onReset: () => void }) {
  const s = useSession();
  return (
    <header aria-label="Prototypens verktyg" className="flex items-center gap-3 bg-antracit px-4 py-2 text-vit">
      <span className="font-bold">Prototyp</span>
      <label htmlFor="roll">Roll</label>
      <select id="roll" className="text-antracit" value={`${s.actor.userId}|${s.actor.role}`} onChange={(e) => { const [u, r] = e.target.value.split("|"); s.switchRole?.(r as never, u); }}>
        {personas.map((p) => (
          <option key={`${p.actor.userId}|${p.actor.role}`} value={`${p.actor.userId}|${p.actor.role}`}>{p.user.name}</option>
        ))}
      </select>
      <button type="button" onClick={onReset}>Återställ</button>
    </header>
  );
}
