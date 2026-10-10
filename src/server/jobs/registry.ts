// Jobbtyperna: send_message (utskick – och uppgiften att ringa deltagaren när kallelsen eller inbjudan inte går fram), röstinspelningens jobb (transkribering, utkast och gallring – voice.ts),
// rapportutkasten (report_schedule – reports.ts), timjobben attachments_retention och auth_cleanup (attachments.ts) och
// mejlinläsningen från avrop@ varannan minut (inbox_import – inbox.ts, beslut 4c 2026-10-08).
// Senare (docs/UTSKICK.md): närvaropåminnelser, progressionsbevakning.
import { participantSendStopped } from "@/features/_shared/participant-notify";
import { invitationOf, messageIdOf, sendMessageJob, type SenderDeps } from "../notify/sender";
import { attachmentJobHandlers, type AttachmentJobDeps } from "./attachments";
import { SEND_MESSAGE } from "../notify/types";
import { INBOX_IMPORT_JOB, inboxJobHandler, type InboxJobDeps } from "./inbox";
import { REPORT_SCHEDULE_JOB, reportScheduleHandler, type ReportDeps } from "./reports";
import type { JobHandler } from "./runner";
import { voiceJobHandlers, type VoiceDeps } from "./voice";

/** Det jobben behöver. Varje jobbtyp får sin del. voice och system byggs först när ett sådant jobb körs. */
export type JobDeps = { notify: SenderDeps } & VoiceDeps & ReportDeps & AttachmentJobDeps & InboxJobDeps;

export const JOB_HANDLERS: Readonly<Record<string, JobHandler<JobDeps>>> = {
  [SEND_MESSAGE]: {
    // Ett utskick till en deltagare som stoppas eller misslyckas när det skickas ger samordnaren uppgiften att ringa, om inget
    // annat skriftligt utskick i samma omgång gick (participantSendStopped – idempotent, körs också när utskicket redan var avgjort,
    // så att ett avbrutet försök tar igen uppgiften).
    run: async (job, d) => {
      const outcome = await sendMessageJob.run(job, d.notify);
      if (d.voice) await participantSendStopped(d.voice(), messageIdOf(job), invitationOf(job));
      return outcome;
    },
    onGiveUp: async (job, reason, d) => {
      await sendMessageJob.onGiveUp(job, reason, d.notify);
      const id = (job.payload as { messageId?: unknown } | null)?.messageId;
      if (d.voice && typeof id === "string" && id) await participantSendStopped(d.voice(), id, invitationOf(job));
    },
  },
  ...voiceJobHandlers<JobDeps>(),
  [REPORT_SCHEDULE_JOB]: reportScheduleHandler<JobDeps>(),
  // Bilagornas gallring och städningen av Auth-användare utan profil (beslut 2026-10-07).
  ...attachmentJobHandlers<JobDeps>(),
  // Mejlinläsningen från avrop@ (beslut 4c, 2026-10-08).
  [INBOX_IMPORT_JOB]: inboxJobHandler<JobDeps>(),
};
