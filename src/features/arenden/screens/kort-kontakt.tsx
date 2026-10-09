"use client";
// Ändra kontaktväg på deltagarkortet (coachmötet 2026-10-09): kommunen anger inte längre hur deltagaren vill bli kontaktad –
// Miljonbemanning frågar vid första mötet och för in svaret här. Samma regler som Registrera beställning (contactErrors).
// Kommandot arenden.caseSetContact loggar bara vilka fält som ändrades – aldrig värdena.
import { useState } from "react";
import { contactErrors } from "@/core/contact";
import { useCommand } from "@/shell/backend";
import { Button, Field, FormGrid, Input, Kv, Modal, Seg, Stack, toast, type IconName } from "@/ui";
import { CARD_CONTACTS, caseSetContact, type CaseCard } from "../api";

type CardContact = (typeof CARD_CONTACTS)[number];
const CONTACTS: { value: CardContact; label: string; icon: IconName }[] = [
  { value: "sms", label: "SMS", icon: "message" },
  { value: "phone", label: "Telefon", icon: "phone" },
  { value: "email", label: "E-post", icon: "mail" },
];
const isCardContact = (v: string): v is CardContact => (CARD_CONTACTS as readonly string[]).includes(v);

/** Dialogen Ändra kontaktväg. Visas bara när kortet har kontaktuppgifter att ändra (card.contact). */
export function ContactModal({ card: c, onClose }: { card: CaseCard; onClose: () => void }) {
  const save = useCommand(caseSetContact);
  const start = c.contact;
  const [contact, setContact] = useState<CardContact>(start && isCardContact(start.preferredContact) ? start.preferredContact : "sms");
  const [phone, setPhone] = useState(start?.phone ?? "");
  const [email, setEmail] = useState(start?.email ?? "");
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ phone?: string; email?: string }>({});
  const errs = contactErrors({ preferredContact: contact, phone, email });
  const dirty = !!start && (contact !== start.preferredContact || phone.trim() !== start.phone || email.trim() !== start.email);
  const submit = async () => {
    setTried(true);
    if (errs.phone || errs.email) return;
    const res = await save.run({ caseId: c.caseId, preferredContact: contact, phone: phone.trim(), email: email.trim() }).catch(() => null);
    if (!res || !res.ok) {
      if (res && !res.ok && (res.error === "phone" || res.error === "email")) setServerErr({ [res.error]: res.message });
      else toast(res && !res.ok && res.message ? res.message : "Kontaktvägen kunde inte sparas.", "error");
      return;
    }
    toast(res.changed ? `Kontaktvägen för ${c.caseNumber} är sparad.` : "Inget ändrades.");
    onClose();
  };
  const err = (k: "phone" | "email") => (tried ? errs[k] ?? serverErr[k] ?? null : null);
  return (
    <Modal
      title="Ändra kontaktväg"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>Spara kontaktvägen</Button>
        </>
      }
    >
      <Stack>
        <Kv items={[["Ärende", <span key="n" className="font-bold tabular-nums">{c.caseNumber}</span>]]} />
        <Field id="arn-contact" label="Hur vill deltagaren bli kontaktad?" required help="Fråga deltagaren vid första mötet. Kallelser och påminnelser går den vägen.">
          <Seg
            id="arn-contact"
            value={contact}
            onValueChange={(v) => {
              setContact(v);
              setServerErr({});
            }}
            options={CONTACTS}
          />
        </Field>
        <FormGrid>
          <Field id="arn-contact-phone" label="Deltagarens telefonnummer" required={contact !== "email"} error={err("phone")} help="För kallelse och påminnelser. SMS innehåller aldrig personuppgifter.">
            <Input type="tel" value={phone} onValueChange={(v) => { setPhone(v); setServerErr({}); }} maxLength={40} autoComplete="off" />
          </Field>
          <Field id="arn-contact-email" label="Deltagarens e-postadress" required={contact === "email"} error={err("email")}>
            <Input type="email" value={email} onValueChange={(v) => { setEmail(v); setServerErr({}); }} maxLength={200} autoComplete="off" />
          </Field>
        </FormGrid>
      </Stack>
    </Modal>
  );
}
