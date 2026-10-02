"use client";
// Mallar och utskick (/admin/mallar, ?flik=logg för utskicksloggen – prototypens admin.mallar).
// Alla utskick byggs från versionerade mallar och innehåller aldrig personuppgifter – bara ärendenummer och en länk till portalen.
import { useEffect, useRef, useState } from "react";
import { plural } from "@/core/format";
import { fmtDate, fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly, useRuntime } from "@/shell/runtime";
import {
  Badge, Button, Card, Check, DemoNote, Empty, Field, Grid, Icon, Input, Kpi, List, Notice, Page, PerspectiveLink, QueryView, Row, Seg, Split, Stack, TabPanel, Tabs, TextArea, cn, toast,
  useConfirm,
} from "@/ui";
import { adminSaveTemplate, adminTemplates, type SendLogItem, type TemplateView, type TemplatesView } from "../api";
import { ALLOWED_PLACEHOLDERS, CHANNEL_LABEL, GENERIC_PORTAL, fillExample, templateCheck, type TemplateCheck } from "../templates";
import { KV } from "./parts";

type MallTab = "mallar" | "logg";
const CH_ICON: Record<string, "message" | "mail" | "file"> = { sms: "message", email: "mail", brev: "file", letter: "file" };
const listSv = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}` : xs.join(""));

const ChannelBadge = ({ ch }: { ch: string }) => (
  <Badge tone="outline" icon={CH_ICON[ch] ?? "mail"}>
    {CHANNEL_LABEL[ch] ?? ch}
  </Badge>
);
const ChannelBadges = ({ t }: { t: TemplateView }) => (
  <>
    {[t.channel, ...t.alsoVia].map((c) => (
      <ChannelBadge key={c} ch={c} />
    ))}
  </>
);
const CheckBadge = ({ c }: { c: TemplateCheck }) =>
  c.ok ? <Badge tone="outline" icon="check">Inga personuppgifter</Badge> : <Badge tone="red" icon="alert">Innehåller personuppgifter</Badge>;
const checkOf = (t: Pick<TemplateView, "subject" | "body">) => templateCheck(`${t.subject || ""}\n${t.body}`);

export function MallarScreen({ query }: ScreenProps) {
  const nav = useNav();
  const tab: MallTab = query.get("flik") === "logg" ? "logg" : "mallar";
  const q = useQuery(adminTemplates, {});
  return (
    <Page
      title="Mallar och utskick"
      eyebrow="E-post och SMS"
      lead="Alla utskick byggs från versionerade mallar. De innehåller aldrig personuppgifter – bara ärendenummer och en länk till portalen."
    >
      <Tabs
        id="mallar"
        ariaLabel="Mallar och utskick"
        active={tab}
        onChange={(id) => nav.replace(path("/admin/mallar", { flik: id === "logg" ? "logg" : null }))}
        tabs={[
          { id: "mallar", label: "Mallar", icon: "file", count: q.data?.templates.length ?? null },
          { id: "logg", label: "Utskickslogg", icon: "send", count: q.data?.sendLog.length ?? null },
        ]}
      />
      <TabPanel tabsId="mallar" active={tab}>
        <QueryView query={q}>{(d) => (tab === "mallar" ? <TemplatesTab d={d} /> : <SendLogTab items={d.sendLog} />)}</QueryView>
      </TabPanel>
    </Page>
  );
}

// ================================================================ Mallar
function TemplatesTab({ d }: { d: TemplatesView }) {
  const [selKey, setSelKey] = useState(d.templates[0]?.key ?? "");
  const editorRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  // Mallen som redigeras har ändringar som inte är sparade (rapporteras av TemplateEditor).
  const [editorDirty, setEditorDirty] = useState(false);
  const failing = d.templates.filter((t) => !checkOf(t).ok);
  const cur = d.templates.find((t) => t.key === selKey) ?? d.templates[0];
  const select = async (key: string) => {
    if (key === cur?.key) return;
    if (editorDirty) {
      const ok = await confirm({
        title: "Byta mall?",
        body: `Ändringarna i ${cur?.name ?? "mallen"} är inte sparade. De finns kvar om du går tillbaka till mallen, men försvinner om du laddar om sidan.`,
        confirmLabel: "Byt mall",
        cancelLabel: "Stanna kvar",
      });
      if (!ok) return;
    }
    setSelKey(key);
    // På smal skärm hamnar redigeringen under listan – visa den.
    setTimeout(() => {
      const el = editorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 100 || r.top > window.innerHeight - 120) el.scrollIntoView({ block: "start" });
    }, 30);
  };
  return (
    <Stack>
      {failing.length === 0 ? (
        <Notice tone="ok" title={`Alla ${d.templates.length} mallar klarar kontrollen`}>
          Inga mallar innehåller platshållare för namn, personnummer eller adress. Mallarna redigeras här och varje ändring blir en ny version.
        </Notice>
      ) : (
        <Notice tone="critical" title="Mallar med personuppgifter">
          {failing.map((t) => t.name).join(", ")}
        </Notice>
      )}
      <Split>
        <Card title="Mallar" icon="list" flush>
          <List>
            {d.templates.map((t) => {
              const on = t.key === cur?.key;
              return (
                <button
                  type="button"
                  key={t.key}
                  aria-current={on ? "true" : undefined}
                  onClick={() => void select(t.key)}
                  className={cn(
                    "flex w-full min-w-0 cursor-pointer items-start gap-3 border-x-0 border-t-0 border-b border-ljusgra bg-transparent px-[18px] py-3 text-left text-inherit [font:inherit] last:border-b-0 hover:bg-ljusgra-ton",
                    on && "bg-bla-ton shadow-[inset_4px_0_0_var(--color-rod)] hover:bg-bla-ton",
                  )}
                >
                  <Icon name={t.channel === "sms" ? "message" : "mail"} className="mt-0.5" />
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="font-bold">{t.name}</span>
                    <span className="text-small text-text-muted">{t.to}</span>
                    <Row gap="sm">
                      <ChannelBadges t={t} />
                      <Badge tone="grey">v{t.version}</Badge>
                      <CheckBadge c={checkOf(t)} />
                    </Row>
                  </span>
                  <Icon name="chevron-right" className="self-center text-text-muted" />
                </button>
              );
            })}
          </List>
        </Card>
        <div ref={editorRef} id="tpl-editor" className="min-w-0 scroll-mt-[140px]">
          {cur && <TemplateEditor key={`${cur.key}:${cur.version}`} tpl={cur} all={d.templates} canEdit={d.canEdit} onDirty={setEditorDirty} />}
        </div>
      </Split>
      <DemoNote>
        I prototypen påverkar en ny mallversion bara den här vyn – utskicken i demot använder de ursprungliga texterna. I den riktiga tjänsten skickas all e-post och alla SMS via en gemensam modul som alltid läser senaste versionen.
      </DemoNote>
    </Stack>
  );
}

function TemplateEditor({ tpl, all, canEdit, onDirty }: { tpl: TemplateView; all: TemplateView[]; canEdit: boolean; onDirty: (dirty: boolean) => void }) {
  const save = useCommand(adminSaveTemplate);
  // Utkastminne per mall och version (bara i minnet): ändringarna finns kvar om man byter mall eller sida och kommer tillbaka.
  const subjectDraft = useDraft(`mall|${tpl.key}|${tpl.version}|amne`, tpl.subject);
  const bodyDraft = useDraft(`mall|${tpl.key}|${tpl.version}|text`, tpl.body);
  const [subject, setSubject] = [subjectDraft.value, subjectDraft.set];
  const [body, setBody] = [bodyDraft.value, bodyDraft.set];
  const chk = templateCheck(`${subject}\n${body}`);
  const dirty = subject !== tpl.subject || body !== tpl.body;
  // Medan det skickas/sparas (kommandot och omhämtningen efteråt) frågar vakten inte: annars varnar sidan för text som just
  // har skickats, innan fältet hunnit tömmas.
  useUnsavedGuard(canEdit && dirty && !save.pending, "Ändringarna i mallen är inte sparade.");
  useEffect(() => {
    onDirty(canEdit && dirty);
    return () => onDirty(false);
  }, [canEdit, dirty, onDirty]);
  const toCustomer = /Kommunens|Ny kommunanvändare|Avsändaren/.test(tpl.to);
  const variants = tpl.variantOf ? all.filter((t) => t.variantOf === tpl.variantOf && t.key !== tpl.key) : [];
  const onSave = async () => {
    const r = await save.run({ key: tpl.key, subject: tpl.channel === "email" ? subject : "", body }).catch(() => null);
    if (r && !r.ok && r.error === "personal_data") return toast("Mallen sparades inte: den innehåller personuppgifter.", "error");
    if (!r || !r.ok) return toast("Mallen kunde inte sparas. Texten får inte vara tom.", "error");
    subjectDraft.clear();
    bodyDraft.clear();
    toast(`${tpl.name} är sparad som version ${r.version}.`);
  };
  return (
    <Card
      title={tpl.name}
      icon={tpl.channel === "sms" ? "message" : "mail"}
      actions={
        <>
          <ChannelBadges t={tpl} />
          <Badge tone="dark">Version {tpl.version}</Badge>
        </>
      }
      foot={
        tpl.fixed ? (
          <span className="text-small text-text-muted">Texten är fast och kan inte ändras här.</span>
        ) : canEdit ? (
          <>
            <Button kind="primary" icon="check" disabled={!dirty || !chk.ok || !body.trim()} pending={save.pending} onClick={() => void onSave()}>
              Spara som version {tpl.version + 1}
            </Button>
            {dirty && (
              <Button kind="ghost" icon="reset" onClick={() => { setSubject(tpl.subject); setBody(tpl.body); subjectDraft.clear(); bodyDraft.clear(); }}>
                Ångra ändringarna
              </Button>
            )}
          </>
        ) : (
          <span className="text-small text-text-muted">Bara systemadmin kan spara en ny version av mallen. Du kan pröva texten och se förhandsvisningen.</span>
        )
      }
    >
      <Stack>
        <KV
          items={[
            ["Avsändare", tpl.from],
            ["Mottagare", tpl.to],
            ["Skickas", tpl.when],
            tpl.alsoVia.length > 0 && ["Kanal", `${listSv([tpl.channel, ...tpl.alsoVia].map((c) => CHANNEL_LABEL[c] ?? c))} – den kontaktväg deltagaren har valt`],
            ["Senast ändrad", `${fmtDate(tpl.updatedAt)}${tpl.updatedByName ? ` av ${tpl.updatedByName}` : ""}`],
          ]}
        />
        {variants.length > 0 && (
          <Notice tone="info" title="Två varianter skickas i dag">
            <Stack gap="sm">
              <p>
                Texten här är exakt den som skickas{" "}
                {tpl.key === GENERIC_PORTAL ? "när en beställning i portalen gäller skyddade personuppgifter" : "när ett mejl till avrop@ gäller skyddade personuppgifter eller inte kan tolkas"}. Den andra varianten:
              </p>
              {variants.map((v) => (
                <div key={v.key} className="border-l-[3px] border-line-strong py-1 pl-2.5">
                  <div className="font-bold">{v.name}</div>
                  <div>{v.body}</div>
                </div>
              ))}
              <p className="text-small text-text-muted">
                Varianterna lovar olika saker: efter ett mejl ringer vi upp handläggaren, efter en portalbeställning ber vi handläggaren ringa oss. Bestäm vilken formulering som ska gälla innan tjänsten byggs.
              </p>
            </Stack>
          </Notice>
        )}
        {tpl.fixed && (
          <Notice tone="info" title="Fast text – mejlet byggs av servern">
            Servern tar fram koden och skickar mejlet direkt till den som loggar in – inte via kön. Koden sparas aldrig: utskicksloggen visar bara att en kod har skickats ({"••••••"}). Mejlet har ingen länk.
          </Notice>
        )}
        {tpl.channel === "email" && !tpl.fixed && (
          <Field id="tpl-subject" label="Ämnesrad" help="Visas i mottagarens inkorg. Bara ärendenummer – aldrig namn.">
            <Input value={subject} onValueChange={setSubject} invalid={!chk.ok} />
          </Field>
        )}
        {!tpl.fixed && (
          <Field
            id="tpl-body"
            label="Text"
            help={
              <>
                Tillåtna platshållare: {ALLOWED_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.
                {tpl.channel === "sms" && (
                  <>
                    {" "}
                    <b>{body.length} tecken</b> – ett SMS rymmer 160.
                  </>
                )}
              </>
            }
          >
            <TextArea rows={tpl.channel === "sms" ? 4 : 7} value={body} onValueChange={setBody} invalid={!chk.ok} />
          </Field>
        )}
        {tpl.fixed ? null : chk.ok ? (
          <Notice tone="ok" title="Innehåller inga personuppgifter">
            Texten innehåller inga platshållare för namn, personnummer eller adress. Utskicket får bara innehålla ärendenummer och länk till portalen.
          </Notice>
        ) : (
          <Notice tone="critical" title="Innehåller personuppgifter – kan inte sparas">
            {chk.pii.length > 0 ? `Ta bort ${chk.pii.join(", ")}. ` : ""}
            {chk.pnr ? "Texten innehåller något som liknar ett personnummer. " : ""}
            E-post och SMS får aldrig innehålla personuppgifter – bara ärendenummer och en uppmaning att logga in.
          </Notice>
        )}
        {chk.unknown.length > 0 && !tpl.fixed && (
          <Notice tone="warn" title="Okänd platshållare">
            {chk.unknown.join(", ")} fylls inte i automatiskt. Använd bara de tillåtna platshållarna.
          </Notice>
        )}
        <Stack gap="sm">
          <div className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Förhandsvisning med exempelvärden</div>
          <div className="rounded-mb border-[1.5px] border-ljusgra bg-ljusgra-ton px-3.5 py-3">
            {tpl.channel === "email" && <div className="mb-1.5 font-bold">{fillExample(subject)}</div>}
            <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{fillExample(body)}</div>
          </div>
        </Stack>
        {toCustomer && (
          <DemoOnly>
            <div>
              <PerspectiveLink role="kommun_handlaggare" to="/portal/rapporter" label="Se vad kommunen får i portalen" />
            </div>
          </DemoOnly>
        )}
        {tpl.history.length > 0 && (
          <Stack gap="sm">
            <div className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Tidigare versioner</div>
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {tpl.history.map((h) => (
                <li key={h.version} className="text-small">
                  Version {h.version} · {fmtDateTime(h.savedAt)} · {h.savedByName}
                </li>
              ))}
              <li className="text-small text-text-muted">
                Version {tpl.baseVersion} · {fmtDate(tpl.baseUpdatedAt)} · ursprunglig
              </li>
            </ul>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

// ================================================================ Utskickslogg
type ChFilter = "alla" | "email" | "sms" | "brev";
function SendLogTab({ items }: { items: SendLogItem[] }) {
  const demo = useRuntime() === "demo";
  const [ch, setCh] = useState<ChFilter>("alla");
  const [mine, setMine] = useState(false);
  const leaks = items.filter((n) => n.leak);
  const letters = items.filter((n) => n.channel === "brev" || n.channel === "letter").length;
  const list = items.filter((n) => (ch === "alla" || n.channel === ch || (ch === "brev" && n.channel === "letter")) && (!mine || n.byTester));
  const opts: { value: ChFilter; label: string; icon?: "mail" | "message" | "file" }[] = [
    { value: "alla", label: "Alla" },
    { value: "email", label: "E-post", icon: "mail" },
    { value: "sms", label: "SMS", icon: "message" },
    ...(letters > 0 ? [{ value: "brev" as const, label: "Brev", icon: "file" as const }] : []),
  ];
  return (
    <Stack>
      <Grid cols={4}>
        <Kpi label="Utskick" value={items.length} sub={letters > 0 ? `e-post, SMS och ${plural(letters, "brev", "brev")}` : "e-post och SMS"} />
        <Kpi label="E-post" value={items.filter((n) => n.channel === "email").length} />
        <Kpi label="SMS" value={items.filter((n) => n.channel === "sms").length} />
        <DemoOnly>
          <Kpi label="Orsakade av dig" value={items.filter((n) => n.byTester).length} sub="i prototypen" />
        </DemoOnly>
      </Grid>
      {leaks.length === 0 ? (
        <Notice tone="ok" title="Kontroll: inga utskick innehåller namn eller personnummer">
          Alla {items.length} texter har kontrollerats mot deltagarregistret. De innehåller bara ärendenummer och en uppmaning att logga in i portalen.
        </Notice>
      ) : (
        <Notice tone="critical" title={`${leaks.length} utskick kan innehålla personuppgifter`}>
          Granska utskicken som är markerade nedan.
        </Notice>
      )}
      <Row between>
        <Seg ariaLabel="Kanal" value={ch} onValueChange={setCh} options={opts} />
        <DemoOnly>
          <Check id="log-mine" checked={mine} onCheckedChange={setMine}>
            Bara utskick du orsakat
          </Check>
        </DemoOnly>
      </Row>
      <Card title={`Utskickslogg (${list.length})`} icon="send" flush>
        {list.length === 0 ? (
          <Empty icon="send" title="Inga utskick att visa">
            Ändra filtret, eller gör något som skickar e-post eller SMS – till exempel acceptera ett avrop.
          </Empty>
        ) : (
          <List>
            {list.map((n) => (
              <div key={n.id} data-send-item="" className={cn("flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0", demo && n.byTester && "shadow-[inset_4px_0_0_var(--color-bla)]")}>
                <Icon name={CH_ICON[n.channel] ?? "mail"} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <Row gap="sm">
                    <span className="font-bold">{n.templateLabel}</span>
                    <ChannelBadge ch={n.channel} />
                    {n.byTester && (
                      <DemoOnly>
                        <Badge tone="dark" icon="user">Orsakat av dig i prototypen</Badge>
                      </DemoOnly>
                    )}
                  </Row>
                  <div className="text-small text-text-muted">
                    {fmtDateTime(n.at)} · Till {n.to}
                    {n.caseNumber ? ` · ärende ${n.caseNumber}` : ""}
                  </div>
                  <div className="mt-1 border-l-[3px] border-ljusgra px-2.5 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{n.body}</div>
                  <div>{n.leak ? <Badge tone="red" icon="alert">Kan innehålla personuppgifter</Badge> : <Badge tone="blue" icon="check">Inga personuppgifter</Badge>}</div>
                </div>
              </div>
            ))}
          </List>
        )}
      </Card>
      <DemoNote>SMS-mottagare visas maskerade. I den riktiga tjänsten loggas utskicket med mottagarens id, och texten byggs alltid från en mall utan personuppgifter.</DemoNote>
    </Stack>
  );
}
