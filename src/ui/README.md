# src/ui – MB:s komponentbibliotek

Samma komponenter i riktiga appen (Next.js) och i prototypen (Vite). Utseendet är den gamla prototypens (`prototyp/src/styles.css`,
granskat för WCAG 2.1 AA och MB:s grafiska profil): antracit sidopanel, versala etiketter med spärrning, röd punkt som accent,
44 px klickytor, kommunportalen i 18 px.

```tsx
import { Page, Card, Button, Table, Field, Input, Notice, QueryView, toast } from "@/ui";
```

**Regler för allt i `src/ui`:** inga `next/*`-importer (koden körs även i Vite), länkar bara via `Link` från `@/shell/nav`, ingen
dataåtkomst (inga `useQuery`, inga imports från `src/data` eller `src/server`) – skärmen skickar in värden och callbacks.
Färger bara från temat i `src/app/globals.css`. Inget grönt.

---

## 1. Tema och Tailwind-klasser

Tokens i `src/app/globals.css` (`@theme`). Använd dem i skärmarnas egna klasser.

| Token | Klass (exempel) | Används till |
|---|---|---|
| `antracit` `#1E252B` | `bg-antracit` `text-antracit` `border-antracit` | text, primära ytor, sidopanelen |
| `rod` `#FF0C01` | `bg-rod` `border-rod` `text-rod` (bara ikoner/stor fet text) | accent, "kräver åtgärd" |
| `rod-logo` `#ED2526` | `bg-rod-logo` | bara punkten i ordmärket |
| `ljusgra` `#D1D3D3` | `bg-ljusgra` `border-ljusgra` | linjer, "Gul" |
| `bla` `#6BA2B9` | `bg-bla` `border-bla` (aldrig text på vitt) | "Grön", klart, AI |
| `vit` | `bg-vit` `text-vit` | |
| tonade ytor | `bg-antracit-ton` `bg-bla-ton` `bg-bla-ton2` `bg-rod-ton` `bg-rod-ton2` `bg-ljusgra-ton` `bg-ljusgra-ton2` | hover, markerade rader, rutor |
| text | `text-text-muted` (≈6:1) · `text-text-faint` (≈4,6:1, minsta för text) | underrader, metadata |
| linje | `border-line-strong` | fältramar, streckade ramar |
| textstorlekar | `text-label` 12 · `text-meta` 13 · `text-small` 14 · `text-ui` 15 · `text-body` 16 · `text-h3` 17 · `text-h2` 19 · `text-h1` 26 · `text-portal` 18 | radavstånd 1,5 (rubriker 1,25) |
| hörn | `rounded-mb` 6 px · `rounded-card` 10 px | knappar/fält · kort |
| skuggor | `shadow-card` · `shadow-pop` | papper · dialoger |
| animation | `animate-toast-in` · `animate-blink` | |

Varianter:

- **`portal:`** – gäller inuti kommunportalen (element med `data-area="portal"`; portallayouten sätter det, dialoger och toasts ärver det via `useAreaAttr`). Komponenterna har redan portalstorlekarna (18 px text, 52 px knappar, större etiketter).
- Brytpunkter som prototypen: `max-[900px]:` (sidopanelen blir toppmeny), `max-[980px]:` (Split/Grid färre kolumner), `max-[620px]:` (en kolumn), `max-[520px]:` (Kv staplas).

`cn(...)` (`src/ui/cn.ts`) sammanfogar klasser med clsx + tailwind-merge (känner till temats storlekar – använd alltid `cn` när du lägger till klasser på en komponent).

Formulärfält (`input`, `select`, `textarea`) har grundutseendet i `@layer base` – även fält som inte går via `Input`/`Select` ser rätt ut.
`aria-invalid="true"` ger röd ram. Fokusmarkering: 3 px antracit (vit på sidopanelen via `--mm-focus`).

**Prototypens CSS-klasser → nytt:**

| Prototypen | Nytt |
|---|---|
| `stack` / `stack-sm` / `stack-lg` | `<Stack>` / `<Stack gap="sm">` / `<Stack gap="lg">` (eller `flex flex-col gap-4/2/7`) |
| `row` / `row-sm` / `row-between` | `<Row>` / `<Row gap="sm">` / `<Row between>` |
| `grid` / `grid-2/3/4` | `<Grid>` / `<Grid cols={2/3/4}>` |
| `split` / `split-wide` | `<Split>` / `<Split wide>` |
| `form-grid`, `.full` | `<FormGrid>`, `<Field full>` |
| `list`, `list-item`, `li-main/li-title/li-sub/li-side`, `clickable` | `<List>`, `<ListItem title sub side onClick/to>` |
| `muted` · `faint` · `small` · `strong` | `text-text-muted` · `text-text-faint` · `text-small` · `font-bold` |
| `num` / `tabular` · `mono` · `nowrap` | `tabular-nums` · `tabular-nums tracking-[0.01em]` · `whitespace-nowrap` |
| `eyebrow` / `label-caps` | `<Eyebrow>` |
| `cell-sub` | `<CellSub>` |
| `dot` | `<Dot>` |
| `spacer` · `divider` | `<Spacer />` · `<Divider />` |
| `sr-only` · `upper` · `center` · `right` | `sr-only` · `uppercase tracking-[0.06em]` · `text-center` · `text-right` |
| `ai-box` · `evidence` · `rec-indicator` | `<AiBox>` · `<Evidence>` · `<RecIndicator>` |
| `paper-*`, `fixed-text`, `xbox`, `watermark-draft` | `<Paper>`, `<PaperFixedText>`, `<XBox>`, `Paper draft=` |
| `bigbtns` / `bigbtn(.primary)` / `bb-sub` | `<BigButtons>` / `<BigButton primary sub>` |
| `pulse-phone` · `smileys` / `smiley` | `<PulsePhone>` · `<Smileys>` / `<Smiley>` |
| `chart`, `axis`, `grid-line` | `<Chart aria-label>` med `className="axis"` / `"grid-line"` på linjerna |
| `table-wrap`/`table`, `row-alert`/`row-muted`/`selected` | `<Table rowTone={…}>` som returnerar `"alert"`, `"muted"` eller `"selected"` |

---

## 2. Sidor och struktur

### `Page` – en per skärm i MB:s arbetsyta
```tsx
<Page
  eyebrow="Samordnare · Sara Lindqvist"
  title="Startsida"
  lead="God morgon! Det mest brådskande står först."
  crumbs={[{ label: "Ärenden", to: "/arenden" }, { label: "BOT-26-0143" }]}
  actions={<Button kind="primary" icon="plus">Nytt ärende</Button>}
>
  …innehåll…
</Page>
```
Props: `title` (versaler, röd punkt, `h1`), `eyebrow?`, `lead?`, `actions?`, `crumbs?: { label; to? }[]` (sista utan `to` = aktuell sida), `className?`.
Max 1240 px bred, 32 px sidmarginal (16 px under 900 px). Kommunportalen använder inte `Page` – portallayouten har redan sidbredd 860 px; skriv
rubriken själv (`<Eyebrow>` + `<h1>` med `<Dot>`) som `KomHead` i `src/features/kommun/screens/parts.tsx`.

### `Card`
```tsx
<Card title="Avropsinkorg" icon="inbox" actions={<Button kind="ghost" to="/inkorg" iconRight="arrow-right">Öppna inkorgen</Button>} flush>
  <List>…</List>
</Card>
```
Props: `title?`, `icon?`, `actions?`, `tone?: "red" | "blue" | "sub"` (red = kräver åtgärd, blue = klart, sub = tonad yta), `foot?` (sidfot med knappar),
`flush?` (ingen utfyllnad – för tabeller och listor), `id?`, `titleAs?: "h2" | "h3"`, `className?`, `bodyClassName?`.

### `Section`
Rubrik utan ram (versal etikett med röd punkt) + innehåll. Props: `title`, `actions?`.

### Layoutprimitiver
`Stack` (`gap: "xs" | "sm" | "md" | "lg"`, `as?`), `Row` (`gap: "sm" | "md"`, `between?`, `nowrap?`), `Grid` (`cols: "auto" | 2 | 3 | 4`),
`Split` (`wide?` = 2:1), `FormGrid`, `Divider`, `Spacer`, `Eyebrow`, `Dot`, `Brand` (`name = "Miljonmatch"`, `size`), `IconText` (`icon`, text).

### `List` + `ListItem`
```tsx
<List>
  <ListItem lead={<SlaBadge sla={row.sla} dueAt={row.dueAt} />} title="BOT-27-0048 · Beställning" sub="Word-mall" side={<Button to={`/inkorg/${row.emailId}`}>Öppna</Button>} />
  <ListItem icon="file" title="Månadsrapport januari 2027" sub="Levererad 1 feb kl. 09.03" to={`/rapporter/${r.id}`} chevron marked />
</List>
```
Props: `title?`, `sub?`, `side?` (högerkolumn; under 620 px på egen rad), `icon?`, `lead?`, `children?`,
`to?` (hela raden är en länk) eller `onClick?` (hela raden är en knapp), `chevron?`, `marked?` (röd vänsterkant, t.ex. oläst), `aria-label?`.
Lägg inte knappar i `side` på en rad som själv har `to`/`onClick` (nästlade interaktiva element).

---

## 3. Knappar, märken och status

### `Button` (alias `Btn`)
```tsx
<Button kind="primary" icon="check" pending={cmd.pending} onClick={save}>Godkänn</Button>
<Button to="/arenden" iconRight="arrow-right">Till ärenden</Button>
<Button icon="refresh" ariaLabel="Uppdatera" />
```
`kind`: `primary` (huvudåtgärden) · `secondary` (standard) · `ghost` (textknapp) · `danger` (riskabel: röd ram) · `red` (röd yta – bara stor fet text) · `blue`.
`size?: "lg"` (56 px), `block?`, `icon?`, `iconRight?`, `to?` (blir en `Link`), `pending?` (inaktiv + `aria-busy`), `ariaLabel?` (krävs utan text),
`ariaPressed?`, samt vanliga knappattribut (`type`, `disabled`, `title`, `id` …). Minst 44 × 44 px (52 px i portalen).
`buttonVariants({ kind, size })` ger klasserna om du behöver dem på ett annat element.

### `Badge`
`tone`: `blue` · `bluetone` · `grey` (standard) · `red` (vit med röd ram) · `redfill` · `dark` · `outline` · `plan` (streckad – planerat/fas). `icon?`, `title?`.

### `Status` – samlad status (Grön/Gul/Röd)
`<Status value={a.overallStatus} />` → "Grön – enligt plan" / "Gul – risk eller extra åtgärd" / "Röd – kräver omplanering eller dialog"; `short` = bara
"Grön"/"Gul"/"Röd"; `null` = "Ej bedömd". Alltid text + ikon: Grön → blå yta, Gul → ljusgrå, Röd → röd ram. Texterna finns som `STATUS_TEXT`, `STATUS_SHORT`, `STATUS_ICON`.

### `CaseStatusBadge` (prototypens `CaseStatus`)
`<CaseStatusBadge status={c.status} />` – Mottagen, Ordererkänd, Bekräftad, Pågår, Pausad, Avslutad, Avböjd (etiketterna från `CASE_STATUS_LABEL` i `src/core/labels`).

### `SlaBadge`
```tsx
<SlaBadge sla={row.sla} dueAt={row.dueAt} prefix="Svar:" />
```
`sla: { label, tone }` räknas i **hanteraren** med `slaStatus(dueAt, metAt, { now: ctx.now() })` från `src/core/sla` och skickas i vy-modellen (kitet har ingen klocka).
`tone`: `ok` (grå) · `soon` (antracit ram, ≤ 8 h) · `urgent` (röd ram, ≤ 2 h) · `over` (antracit yta, försenad) · `met` (blå, klar). `dueAt?` ger
tooltip "Förfaller måndag 1 feb 2027 kl. 10.05".

### Övrigt
- `PhaseBar({ phase, total = 5 })` – deltagarresan som stapel. `PhaseTag({ phase, name })` – "Fas 4 · Praktik/APL" (namnet från avtalskonfigurationen).
- `BuildPhase({ fas })` – "Byggs i fas 2" (SPEC §12).
- `AiTag` ("AI-förslag"), `AiBox` (blå ruta för AI-förslag), `Evidence({ quote, t })` (citat + "Tidpunkt mm:ss", `t` i sekunder),
  `RecIndicator` ("Spelar in 03:12"). AI föreslår – människan bedömer: bedömningsfält är tomma tills coachen valt.

---

## 4. Tabell

```tsx
const columns: Column<Row>[] = [
  { key: "caseNumber", label: "Ärende", render: (r) => <CaseLink caseId={r.caseId} caseNumber={r.caseNumber} />, nowrap: true },
  { key: "amountOre", label: "Belopp", num: true, render: (r) => kr(r.amountOre) },
];
<Card flush>
  <Table caption="Fakturaunderlag januari" columns={columns} rows={rows} rowKey="caseId" onRowClick={(r) => nav.push(`/ekonomi/2027-01/faktura/${r.caseId}`)}
         rowTone={(r) => (r.blocked ? "alert" : null)} empty="Inga fakturor." footer={<tr><td>Summa</td><td className="text-right tabular-nums">…</td></tr>} />
</Card>
```
`columns: { key, label, render?, num?, width?, nowrap? }[]`, `rows`, `rowKey?` (fält eller funktion, standard `"id"`), `onRowClick?` (raden nås med Tab +
Enter/mellanslag), `rowTone?` → `"alert" | "muted" | "selected"`, `empty?`, `footer?`, `caption?` (för skärmläsare). `CellSub` = dämpad underrad i en cell.

---

## 5. Formulär

Alla kontroller tar `value` + `onValueChange(value)` (kryssrutan `checked` + `onCheckedChange`). Inuti ett `Field` får kontrollen automatiskt
`id`, `aria-describedby` (hjälptext + fel), `aria-invalid` och `required`.

```tsx
<FormGrid>
  <Field label="Beställarreferens" help="8–10 siffror." required error={tried ? errors.buyerReference : undefined}>
    <Input value={f.buyerReference} onValueChange={set("buyerReference")} inputMode="numeric" maxLength={10} />
  </Field>
  <Field label="Avtalsområde">
    <Select value={f.area} onValueChange={set("area")} placeholder="Välj avtalsområde" options={areas.map((a) => ({ value: a.code, label: a.name }))} />
  </Field>
  <Field label="Samlad status" full>
    <Seg value={f.status} onValueChange={set("status")} options={[{ value: "green", label: "Grön", icon: "check-circle", tone: "green" }, …]} />
  </Field>
  <Check checked={f.consent} onCheckedChange={set("consent")}>Deltagaren har gett samtycke</Check>
</FormGrid>
```

- **`Field`**: `label?`, `help?` (kommunportalen: vid varje fält), `error?` (röd ikon + text, läses upp), `required?` (röd asterisk + "(obligatoriskt)" för skärmläsare), `id?` (annars genererat), `full?` (hela bredden i `FormGrid`).
- **`Input`**: `type?` (text, email, tel, number, search, password, url), `value`, `onValueChange`, `invalid?`, samt vanliga attribut (`inputMode`, `maxLength`, `placeholder`, `autoComplete` – standard `off`).
- **`DateInput`** (`'YYYY-MM-DD'`), **`TimeInput`** (`'HH:mm'`), **`DateTimeInput`** (`'YYYY-MM-DDTHH:mm'` = `LocalDateTime`).
- **`Select`**: inbyggd `<select>` (bäst för skärmläsare). `options: ({ value, label, disabled? } | string)[]`, `placeholder?` (tomt första val).
- **`TextArea`**: `rows?` (3).
- **`Check`**: kryssruta med etikett, hela raden klickbar (44 px). `checked`, `onCheckedChange`, `disabled?`, `id?`.
- **`Seg`**: knappgrupp för snabba val (`aria-pressed`). `options: (V | { value, label, icon?, tone?: "green" | "yellow" | "red", lang?, dir?, disabled? })[]`,
  `multi` = flerval (`value` är en lista). `ariaLabel?` – inuti ett `Field` namnges gruppen av fältets etikett.

---

## 6. Flikar

```tsx
const flik = query.get("flik") ?? "oversikt";
<Tabs id="arende" active={flik} onChange={(id) => nav.replace(path(`/arenden/${caseId}`, { flik: id }))}
      tabs={[{ id: "oversikt", label: "Översikt" }, { id: "narvaro", label: "Närvaro", count: 2 }]} />
<TabPanel tabsId="arende" active={flik}>…</TabPanel>
```
Piltangenter, Home och End byter flik. `count` 0 eller null visas inte. Flikval hör hemma i URL:en (`?flik=`).

---

## 7. Dialoger, toasts, filer

- **`Modal`** – rendera villkorligt: `{open && <Modal title="Acceptera avrop" onClose={() => setOpen(false)} footer={…}>…</Modal>}`.
  Radix Dialog: fokusfälla, Escape och klick utanför stänger (om `onClose` finns), fokus till första fältet eller knappen, fokus tillbaka när den stängs. `wide?` = 920 px.
- **`Drawer`** – låda från höger: `title`, `onClose`, `actions?`, `footer?`.
- **`useConfirm()`** – ersätter `MM.confirm` (aldrig `window.confirm`):
  `if (await confirm({ title: "Avböj avropet?", body: "…", confirmLabel: "Avböj", tone: "danger" })) …` → `true`/`false`. (`confirmDialog` = samma utan hook.)
- **`toast(text, tone?)`** / **`useToast()`** – `tone`: `"ok"` (blå kant, standard) eller `"error"` (röd kant). Prototypens `MM.toast(x, 'blue')` → `toast(x)`, `'red'` → `toast(x, "error")`.
  Visas 5,2 s, läses upp (`role=status`). Texten får aldrig innehålla personuppgifter som inte redan syns på skärmen.
- **`useDownload()`** – `await download("fakturaunderlag-2027-01.csv", csv, mime?)`. Riktiga appen: Blob + tillfällig länk (textfiler får BOM för Excel).
  Prototypen byter implementation med `<DownloadProvider impl={…}>` (artefaktens nedladdning, annars `showText`). Skärmar använder aldrig `<a download>`.
- **`useCopy()`** – `await copy(text)` → toast "Kopierat." eller felet.
- **`useTextDialog()`** / `showText({ title, text, note? })` – text att kopiera i en dialog (`note` visas bara i prototypen).

Värdarna (`Toaster`, `ConfirmHost`, `TextDialogHost`) ligger redan i layouten – skärmar renderar dem inte.

---

## 8. Meddelanden och laddning

- **`Notice`** – `tone`: `info` (blå, standard) · `warn` (grå, antracit kant) · `critical` (röd, `role=alert`) · `ok`. `title?`, `icon?`.
- **`DemoNote`** – förklaring som **bara visas i prototypen** ("Prototyp: …", streckad ram). Allt annat är likadant i appen.
- **`Empty`** – `icon?`, `title`, `children?`, `action?`.
- **`Loading`** – "Hämtar…" (syns efter 250 ms så att snabba svar inte blinkar). `label?`.
- **`ErrorNotice`** – `error`, `title?` ("Uppgifterna kunde inte hämtas"), `onRetry?`. Visar API:ts egen text (fel med `code`, t.ex. "Din roll har inte behörighet till det här.") – tekniska fel får "Något gick fel. Försök igen."
- **`QueryView`** – laddning och fel för `useQuery` i ett:
  ```tsx
  const q = useQuery(inboxList, { filter: "att_hantera" });
  return <QueryView query={q}>{(rows) => <Table rows={rows} … />}</QueryView>;
  ```

---

## 9. Data

- **`Kpi`** – `label`, `value`, `sub?`, `tone?: "alert" | "watch"` (ram + "Kräver åtgärd"/"Bevaka" med ikon), `statusText?` (egen statustext), `children?`.
- **`Meter`** – `value`, `max = 1`, `tone?: "blue" | "red"`, `markers?: { value, label, tone?: "red" | "dark" }[]` (avtalets mål rött, internt mål antracit), `label?` (för skärmläsare).
  Det interna målet visas aldrig i kundens perspektiv – det avgör skärmen.
- **`Kv`** – `items: [label, value][]`; `null`/`false` hoppas över, saknat värde visas "–". Staplas under 520 px.
- **`Timeline`** – `items: { icon?, title, sub?, body?, tone?: "red", filled?, key? }[]`.
- **`Stepper`** – `steps: ReactNode[]`, `current` (0-baserat); klara steg får bock och "Klart:" för skärmläsare.
- **`Avatar`** – `name` (initialer), `size?: "sm"`, `onDark?`. **`UserName`** – `name`, `withAvatar = true`.
- **`Chart`** – `<svg>` för egna diagram: `aria-label` krävs; `className="axis"`/`"grid-line"` på linjer, text i antracit 12 px.

## 10. Ärenden och personuppgifter

- **`CaseLink`** – `caseId`, `caseNumber`, `children?`, `canOpen = true`. Leder till rätt vy för rollen (`casePathFor`): kommunen `/portal/deltagare/:id`,
  ekonom `/ekonomi/arende/:id`, övriga `/arenden/:id`. Klick bubblar inte till en klickbar tabellrad.
- **`MaskedPnr`** – `masked` (t.ex. `"••••••••-1234"`, räknas i hanteraren), `onReveal?: () => Promise<string | null>` (ett tyst kommando som loggar visningen i
  revisionsloggen och returnerar numret), `hidden?` ("Visas inte för din roll" – skyddade ärenden, ekonom). Efter visning: "(visning loggad)".
- **`useAuditView(key, log)`** – loggar en visning en gång per sidladdning och användare: `useAuditView(caseId ? `case.view:${caseId}` : null, () => logView.run({ caseId }))`.
  (Alternativ: frågan som hämtar deltagarkortet loggar själv i hanteraren.)
- **`PerspectiveLink`** – **bara i prototypen**: `role`, `userId?`, `to`, `label?`. Byter roll med `useSession().switchRole` och navigerar till `to`.
  Standardtext "Se samma sak från kundens håll" / "… leverantörens håll". Välj en roll som har åtkomst (handläggaren som beställde, annars `kommun_chef`).

## 11. Kommunportalen och pulsmätningen

- **`BigButtons`** (`ariaLabel`) + **`BigButton`** – `icon`, `title`, `sub?`, `to?`/`onClick?`, `primary?`. Handläggarens startsida.
- **`PulsePhone`** – deltagarens "telefon" (max 420 px, 18 px text), `lang?`, `dir?`. Layouten `puls` ger bakgrunden och centreringen.
- **`Smileys`** (`ariaLabel`) + **`Smiley`** (`pressed`, `onClick`, `ariaLabel?`) – svarsknapparna. Ansiktenas SVG ritar skärmen själv.

## 12. PDF-förhandsvisning

```tsx
<Paper title="Månadsrapport januari 2027" draft="Utkast – inte levererad" info={[["Avtal", contractNo], ["Ärende", c.caseNumber]]}>
  <h2>Närvaro</h2>
  <table>…</table>
  <PaperFixedText>…</PaperFixedText>
</Paper>
```
Logotyp överst, informationsblocket högerställt, rubriker i versaler. Vanliga `h2`, `table`, `th`, `td` får rätt utseende. `XBox({ checked })` = kryssruta i dokumentet
(lägg en `sr-only`-text bredvid: "Genomförd: "). Vid utskrift (Ctrl+P) skrivs bara papperet ut – ingen `window.print()` i koden.

## 13b. Inspelning (`Recorder`, röstinspelningen)

```tsx
<Recorder
  maxSeconds={v.recording.maxMinutes * 60}          // avtalets längsta tid – inspelningen stoppas där
  texts={{ stop: "Stoppa och tolka", hint: "Pausa när samtalet går in på sådant som inte behövs för uppdraget." }}
  onRecorded={(audio) => void send(audio)}           // RecordedAudio: blob, mimeType, durationSec, bytes, simulated, source, fileName
/>
<Recorder record={false} upload maxSeconds={3600} texts={{ fileButton: "Ladda upp och tolka" }} onRecorded={…} />
```

- Spelar in med MediaRecorder: webm/opus (Chrome, Edge, Firefox) eller mp4 (Safari), ca 32 kbit/s. Indikatorn är röd yta med vit
  blinkande punkt och texten "Spelar in 03:12" (`role="timer"` – tiden läses inte upp varje sekund); pausat läge är en grå bricka
  "Inspelningen är pausad · 03:12". Lägena (startad, pausad, fortsätter, stoppad) läses upp i en egen `aria-live`-region.
  Fokus flyttas till Pausa/Fortsätt. Varnar innan sidan lämnas mitt i en inspelning. Mikrofonen stängs när komponenten tas bort.
- Fel på svenska (eller deltagarens språk via `texts`): webbläsaren saknar inspelning, mikrofonen nekad, ingen mikrofon, annat fel.
- `upload` – filväljare för m4a, mp3, wav och webm (högst `maxBytes`, standard 25 MB), med etikett och hjälptext.
- **Prototypen:** `DemoNote` med "Simulera en inspelning" (tid utan ljud, `simulated: true`, `blob: null`) – artefakten saknar ofta
  mikrofon. `allowSimulate={false}` stänger av den. Visas aldrig i appen.
- `size="lg"` (deltagarens mobilvy), `lang`/`dir` (arabiska höger till vänster), `idPrefix`, `disabled`, `onActiveChange` (lås andra val
  medan inspelningen pågår), `children` (t.ex. Stäng).
- Komponenten laddar inte upp något. Skärmen skickar ljudet med `runVoiceFlow` (`src/features/rost/client.ts`): `rost.uploadStart` →
  uppladdning till signerad adress (appen) → områdets kommando (`coach.recordingFinish`, `kommun.dictationFinish`, `rost.send`).
- `audioFileType(file)` ger filtypen för en vald fil (från filändelsen när webbläsaren inte anger den). `RECORDER_ACCEPT` = accept-attributet.

## 13. Ikoner

`<Icon name="inbox" />` – prototypens 89 egna ikoner (24×24, streck), typat `IconName`, lista i `ICON_NAMES`. `size?: "sm" | "md" | "lg" | "xl"`
(16/18/24/36 px), `className?`. Dekorativa (`aria-hidden`) om du inte ger `label`. Status visas aldrig med bara en ikon – alltid text bredvid.

---

## Layouter och navigering (`src/shell`)

- `src/shell/layouts.tsx` – `LayoutFor({ match, children })` väljer layout efter `match.route.area`:
  - **`mb`**: antracit sidopanel (ordmärket MILJONMATCH•, "Notiser" med olästa, rollens meny i grupper med räknare, användarens namn och roll
    under menyn, "Påhittade testdata." i prototypen/utvecklingsläget), mobilmeny under 900 px, `<main id="main">`.
  - **`portal`**: kommunens toppmeny (`PORTAL_NAV`), 18 px, sidbredd 860 px. Ingen meny på `/portal/logga-in` och `/portal` (handläggarens startsida). "Logga ut".
  - **`puls`**: centrerad mobilvy på grå yta.
  - **`om`**: prototypens egna sidor.
  - Alla: skip-länk "Hoppa till innehållet", toasts, bekräftelse- och textdialog. Utvecklingsläget (riktiga appen med testpersoner): raden
    "Utvecklingsläge – testperson: [välj]" överst.
- `src/shell/nav-config.ts` – `navFor(role, { now })` (sidopanelens grupper), `NOTIFICATIONS_ITEM`, `PORTAL_NAV`, `activePath(path, candidates)`
  (längsta träff vinner, så `/arenden/case-1` markerar Ärenden). Räknarna (`count: "inbox" | "deadlines" | "unregistered"`, olästa notiser)
  kommer från frågan `navCounts` (`src/features/session/nav-api.ts`). Ekonomens "Fakturakörning <förra månaden>" räknas från klockan (`session.ping`).
