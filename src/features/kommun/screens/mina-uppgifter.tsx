"use client";
// Mina uppgifter i portalen (/portal/mina-uppgifter) – beslut 2026-10-07, synpunkt #2. Handläggaren fyller i namn,
// telefonnummer och enhet. Efter självregistreringen kommer handläggaren hit direkt (?forsta=1) med en välkomsttext.
// Enheten är fritext (synpunkt #3). E-postadressen är inloggningen och går inte att ändra här.
import { useEffect, useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, ErrorNotice, Field, FormGrid, Input, Kv, Loading, Notice, focusFirstError, useToast } from "@/ui";
import { kommunProfile, kommunProfileSave, type KomProfile } from "../api";
import { CONTACT_PHONE } from "../texts";
import { KomHead, KomPage } from "./parts";

export function PortalProfileScreen({ query }: ScreenProps) {
  const q = useQuery(kommunProfile, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return <ProfileForm d={q.data} first={query.get("forsta") === "1"} />;
}

type Errors = Partial<Record<"name" | "phone" | "unit", string>>;

function ProfileForm({ d, first }: { d: KomProfile; first: boolean }) {
  const save = useCommand(kommunProfileSave);
  const nav = useNav();
  const toast = useToast();
  const [name, setName] = useState(d.name);
  const [phone, setPhone] = useState(d.phone);
  const [unit, setUnit] = useState(d.unit);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const errorCount = Object.keys(errors).length;
  useEffect(() => {
    if (errorCount) focusFirstError(document.getElementById("main"));
  }, [errorCount]);

  const submit = async () => {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Skriv ditt namn.";
    if (phone.replace(/\D/g, "").length < 7) e.phone = "Skriv ett telefonnummer där vi når dig.";
    if (!unit.trim()) e.unit = "Skriv vilken enhet du arbetar på.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const r = await save.run({ fullName: name, phone, unit }).catch(() => null);
    setBusy(false);
    if (!r) {
      toast("Uppgifterna kunde inte sparas. Försök igen.", "error");
      return;
    }
    if (!r.ok) {
      setErrors({ [r.error]: r.message || "Kontrollera uppgiften." });
      return;
    }
    toast("Dina uppgifter är sparade.");
    nav.push("/portal");
  };

  return (
    <KomPage narrow>
      <KomHead
        eyebrow={d.customerName}
        title={first ? "Välkommen till Miljonmatch" : "Mina uppgifter"}
        lead={first ? "Ditt konto är klart. Fyll i dina uppgifter innan du börjar." : "Uppgifterna används när vi kontaktar dig om dina beställningar."}
        back={first ? undefined : { label: "Till startsidan", to: "/portal" }}
      />
      {first && (
        <Notice tone="info" title="Så fungerar portalen">
          Här beställer du insatser, följer dina deltagare och läser rapporter från Miljonbemanning.
        </Notice>
      )}
      <Card title="Dina uppgifter" icon="user">
        <form
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
        >
          <FormGrid>
            <Field id="kom-p-name" label="Ditt namn" required error={errors.name} help="För- och efternamn.">
              <Input value={name} onValueChange={setName} autoComplete="name" maxLength={120} />
            </Field>
            <Field id="kom-p-phone" label="Ditt telefonnummer" required error={errors.phone} help="Hit ringer vi om vi har frågor om en beställning.">
              <Input type="tel" value={phone} onValueChange={setPhone} autoComplete="tel" maxLength={40} />
            </Field>
            <Field id="kom-p-unit" label="Enhet" required error={errors.unit} help="Skriv vilken enhet du arbetar på, till exempel Arbetsmarknadsenheten Alby.">
              <Input value={unit} onValueChange={setUnit} maxLength={120} />
            </Field>
          </FormGrid>
          <Kv items={[["E-postadress", d.email || "Inte angiven"]]} />
          <p className="m-0 text-text-muted">
            Du loggar in med e-postadressen.{CONTACT_PHONE ? ` Behöver du byta den kan du ringa oss på ${CONTACT_PHONE}.` : " Behöver du byta den? Hör av dig till din kontakt på Miljonbemanning."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button kind="primary" icon="check" type="submit" pending={busy}>
              Spara
            </Button>
            {!first && (
              <Button kind="ghost" to="/portal">
                Avbryt
              </Button>
            )}
          </div>
        </form>
      </Card>
    </KomPage>
  );
}
