"use client";
// Kommunens beslut om ett bonusanspråk (/portal/bonus/:claimId, SPEC §7.17, beslut 2026-11-04). En sak per skärm:
//   1. Läs underlaget (?steg saknas): vad Miljonbemanning begär och redovisningsunderlaget – också som PDF
//   2. Ditt beslut (?steg=beslut): Godkänn eller Avslå, med frivillig motivering
//   3. Bekräfta (?steg=bekrafta): en mening om vad som händer, Bekräfta beslutet
// Klarspråk, 18 px text, hjälptext vid varje fält och klickytor minst 44 × 44 px (portalens layout). Inga belopp och inga dokument:
// intygen skickas på annat sätt. Visningen av underlaget loggas en gång per sidbesök.
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { pick, useQueryPatch } from "@/shell/url-state";
import { usePageTitle } from "@/shell/page-effects";
import { useUnsavedGuard } from "@/shell/guard";
import type { ScreenProps } from "@/shell/routes";
import { fmtDateFull } from "@/core/time";
import { Button, Card, ErrorNotice, Field, Kv, Loading, Notice, Row, Seg, Stack, TextArea, useAuditView } from "@/ui";
import { KomHead, KomPage } from "@/features/kommun/screens/parts";
import { bonusDecide, bonusPortal, bonusUnderlag, type BonusPortalView } from "../api";
import { BonusStatusBadge } from "./kort-bonus";
import { UnderlagPaper, UnderlagPdfButton } from "./underlag";

const STEPS = ["lasa", "beslut", "bekrafta"] as const;
type Decision = "approved" | "rejected";

export function PortalBonusScreen({ params, query }: ScreenProps) {
  const q = useQuery(bonusPortal, { claimId: params.claimId ?? "" });
  if (q.error) return <KomPage><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></KomPage>;
  if (q.data === undefined) return <KomPage><Loading /></KomPage>;
  if (q.data === null) {
    return (
      <KomPage narrow>
        <KomHead title="Bonus" back={{ label: "Till startsidan", to: "/portal" }} />
        <Notice tone="info" title="Anspråket finns inte">Anspråket finns inte, eller så har du inte behörighet att se det.</Notice>
      </KomPage>
    );
  }
  return <Content key={q.data.claimId} v={q.data} step={pick(query, "steg", STEPS, "lasa")} />;
}

function Content({ v, step }: { v: BonusPortalView; step: (typeof STEPS)[number] }) {
  usePageTitle(`Bonus ${v.caseNumber} · bonussteg ${v.step}`);
  const view = useCommand(bonusUnderlag);
  useAuditView(`bonus:${v.claimId}`, () => view.run({ claimId: v.claimId, purpose: "view" }).catch(() => undefined));
  const patch = useQueryPatch();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<Decision | null>(null);
  const decide = useCommand(bonusDecide);
  const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(!done && (decision !== null || note.trim() !== ""));
  const title = `Bonussteg ${v.step} · ${v.label}`;
  const back = { label: "Till startsidan", to: "/portal" };
  const eyebrow = `${v.participantName} · ${v.caseNumber}`;
  const self = `/portal/bonus/${encodeURIComponent(v.claimId)}`;

  if (done || v.decision) {
    const d = done ?? v.decision?.decision;
    return (
      <KomPage narrow>
        <KomHead eyebrow={eyebrow} title={title} back={back} />
        {/* Just nu beslutat av handläggaren: "Du har …". Annars neutralt – en kollega kan ha beslutat, eller Miljonbemanning
            registrerat ett beslut som kom med mejl. */}
        <Notice
          tone="ok"
          title={
            done
              ? done === "approved" ? "Du har godkänt bonusanspråket" : "Du har avslagit bonusanspråket"
              : `Kommunen har ${d === "approved" ? "godkänt" : "avslagit"} bonusanspråket ${fmtDateFull(v.decision?.at)}`
          }
        >
          {done ? "Beslutet är sparat. Miljonbemanning får veta beslutet." : v.decision?.via === "mejl" ? "Beslut via mejl, registrerat av Miljonbemanning." : "Beslut i portalen."}
          {v.decision?.note && !done ? ` Motivering: ${v.decision.note}` : ""}
        </Notice>
        <Row>
          <UnderlagPdfButton claimId={v.claimId} />
          <Button kind="ghost" icon="arrow-right" to={`/portal/deltagare/${encodeURIComponent(v.caseId)}`}>Till deltagaren</Button>
        </Row>
      </KomPage>
    );
  }

  if (step === "beslut" && v.canDecide) {
    return (
      <KomPage narrow>
        <KomHead eyebrow={eyebrow} title="Ditt beslut" lead={`Bonussteg ${v.step} · ${v.label}`} back={{ label: "Tillbaka till underlaget", to: self }} />
        <Card>
          <Stack>
            <Field label="Godkänner du bonusanspråket?" help="Godkänn om underlaget visar att steget är uppfyllt. Avslå om det inte gör det." id="bonus-beslut">
              <Seg ariaLabel="Godkänner du bonusanspråket?" value={decision ?? ""} onValueChange={(x) => setDecision(x as Decision)} options={[{ value: "approved", label: "Godkänn" }, { value: "rejected", label: "Avslå" }]} />
            </Field>
            <Field label="Motivering (frivillig)" help="Skriv gärna varför, särskilt om du avslår. Högst 1 000 tecken. Skriv inga personnummer." id="bonus-motivering">
              <TextArea value={note} maxLength={1000} rows={3} onValueChange={setNote} />
            </Field>
            <Row>
              <Button kind="primary" iconRight="arrow-right" disabled={!decision} onClick={() => patch({ steg: "bekrafta" })}>
                Fortsätt
              </Button>
            </Row>
          </Stack>
        </Card>
      </KomPage>
    );
  }

  if (step === "bekrafta" && v.canDecide && decision) {
    const onConfirm = async () => {
      setError(null);
      const res = await decide.run({ claimId: v.claimId, decision, ...(note.trim() ? { note: note.trim() } : {}) }).catch(() => null);
      if (!res) return setError("Beslutet kunde inte sparas. Försök igen.");
      if (!res.ok) return setError(res.message || "Beslutet kunde inte sparas.");
      setDone(decision);
    };
    return (
      <KomPage narrow>
        <KomHead eyebrow={eyebrow} title="Bekräfta beslutet" back={{ label: "Ändra beslutet", to: `${self}?steg=beslut` }} />
        <Card>
          <Stack>
            <p className="m-0">
              Du {decision === "approved" ? "godkänner" : "avslår"} bonussteg {v.step} ({v.label}) för {v.caseNumber}.
              {decision === "approved" ? " Miljonbemanning fakturerar bonusen på en egen faktura." : " Miljonbemanning får veta att anspråket är avslaget."}
            </p>
            {note.trim() && <Kv items={[["Din motivering", note.trim()]]} />}
            {error && <Notice tone="critical" title="Det gick inte">{error}</Notice>}
            <Row>
              <Button kind="primary" icon="check" pending={decide.pending} onClick={() => void onConfirm()}>
                Bekräfta beslutet
              </Button>
              <Button kind="ghost" onClick={() => patch({ steg: "beslut" })}>Ändra</Button>
            </Row>
          </Stack>
        </Card>
      </KomPage>
    );
  }

  return (
    <KomPage>
      <KomHead eyebrow={eyebrow} title={title} back={back} lead="Miljonbemanning begär bonus enligt incitamentsmodellen. Läs underlaget och besluta." actions={<BonusStatusBadge status={v.status} text={v.statusText} icon={v.icon} />} />
      <Card>
        <Stack>
          <Kv items={[["Deltagare", v.participantName], ["Ärendenummer", v.caseNumber], ["Bonussteg", `${v.step} · ${v.label}`], ["Skickat", v.sentAt ? fmtDateFull(v.sentAt) : "–"]]} />
          <p className="m-0">Intyg och andra dokument finns inte i portalen. Miljonbemanning skickar dem till dig på annat sätt om du behöver dem.</p>
          {v.waitingForStep3 && <Notice tone="info" title="Beslutas efter bonussteg 3">Bonussteg {v.step} bygger på bonussteg 3. Det kan beslutas när bonussteg 3 är godkänt.</Notice>}
          {v.status === "submitted" && !v.waitingForStep3 && !v.canDecide && (
            <Notice tone="info" title="Handläggaren som beställde beslutar">Bara handläggaren som beställde insatsen kan besluta om bonusanspråket.</Notice>
          )}
          <Row>
            <UnderlagPdfButton claimId={v.claimId} />
            {v.canDecide && (
              <Button kind="primary" iconRight="arrow-right" onClick={() => patch({ steg: "beslut" })}>
                Gå vidare till beslut
              </Button>
            )}
          </Row>
        </Stack>
      </Card>
      <UnderlagPaper u={v.underlag} participantName={v.participantName} />
    </KomPage>
  );
}
